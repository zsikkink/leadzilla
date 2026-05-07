import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import {
  ApproveMessageDraftRequestSchema,
  CreateManualMessageDraftRequestSchema,
  ErrorResponseSchema,
  GenerateMessageDraftRequestSchema,
  GenerateMessageDraftResponseSchema,
  ListMessageDraftsQuerySchema,
  ListMessageDraftsResponseSchema,
  ListMessageSendsQuerySchema,
  ListMessageSendsResponseSchema,
  MessageDraftIdParamsSchema,
  MessageDraftResponseSchema,
  MessageSendIdParamsSchema,
  MessageSendResponseSchema,
  MessageVariantIdParamsSchema,
  MessageVariantResponseSchema,
  RejectMessageDraftRequestSchema,
  SendMessageRequestSchema,
  UpdateMessageVariantRequestSchema,
  ConversationLeadIdParamsSchema,
  ConversationResponseSchema,
  MESSAGE_DRAFT_EVENTS_CHANNEL,
  MessageDraftEventPayloadSchema,
  MessageDraftEventsQuerySchema,
  type MessageDraftEventPayload,
  type MessageDraftResponse,
} from '@lead-flood/contracts';
import { listenToPgChannel, type PgNotificationSubscription } from '@lead-flood/db';

import {
  MessagingDraftGenerationIneligibleError,
  MessagingDraftGenerationUnavailableError,
  MessagingNotFoundError,
  MessagingNotImplementedError,
  MessagingSendIneligibleError,
} from './messaging.errors.js';
import { requireAppAdminAccess } from '../../auth/guard.js';
import { PrismaMessagingRepository } from './messaging.repository.js';
import {
  buildMessagingService,
  type MessageGenerateJobPayload,
  type MessagingSendJobPayload,
} from './messaging.service.js';

export interface MessagingRouteDependencies {
  enqueueMessageSend?: ((payload: MessagingSendJobPayload) => Promise<void>) | undefined;
  enqueueMessageGenerate?: ((payload: MessageGenerateJobPayload) => Promise<void>) | undefined;
}

function sendValidationError(reply: FastifyReply, requestId: string, message: string) {
  reply.status(400);
  return ErrorResponseSchema.parse({
    error: message,
    requestId,
  });
}

function requireAuthenticatedUserId(
  request: FastifyRequest,
  reply: FastifyReply,
): string | null {
  const userId = request.user?.sub;
  if (userId) {
    return userId;
  }

  reply.status(401).send(
    ErrorResponseSchema.parse({
      error: 'Authentication required',
      requestId: request.id,
    }),
  );
  return null;
}

function isDraftEventTargetMatch(
  draft: Pick<MessageDraftResponse, 'id' | 'leadId' | 'followUpNumber' | 'approvalStatus' | 'createdAt'>,
  target: { leadId: string; afterMs?: number | undefined; excludeDraftId?: string | undefined },
): boolean {
  if (draft.leadId !== target.leadId || draft.followUpNumber !== 0) {
    return false;
  }
  if (target.excludeDraftId && draft.id === target.excludeDraftId) {
    return false;
  }
  if (draft.approvalStatus === 'REJECTED') {
    return false;
  }
  if (target.afterMs !== undefined && new Date(draft.createdAt).getTime() < target.afterMs) {
    return false;
  }
  return true;
}

function isMessageDraftEventTargetMatch(
  event: MessageDraftEventPayload,
  target: { leadId: string; afterMs?: number | undefined; excludeDraftId?: string | undefined },
): boolean {
  if (event.leadId !== target.leadId || event.followUpNumber !== 0) {
    return false;
  }
  if (target.excludeDraftId && event.draftId === target.excludeDraftId) {
    return false;
  }
  if (target.afterMs !== undefined && new Date(event.createdAt).getTime() < target.afterMs) {
    return false;
  }
  return true;
}

function writeSseEvent(reply: FastifyReply, event: string, data: unknown): void {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    return;
  }
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
}

function handleModuleError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof MessagingNotFoundError) {
    reply.status(404).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof MessagingDraftGenerationIneligibleError) {
    reply.status(422).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof MessagingDraftGenerationUnavailableError) {
    reply.status(503).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof MessagingSendIneligibleError) {
    reply.status(422).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof MessagingNotImplementedError) {
    reply.status(501).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  return false;
}

export function registerMessagingRoutes(
  app: FastifyInstance,
  dependencies?: MessagingRouteDependencies,
): void {
  const repository = new PrismaMessagingRepository();
  const service = buildMessagingService(repository, {
    enqueueMessageSend: dependencies?.enqueueMessageSend
      ? dependencies.enqueueMessageSend
      : async () => {
          throw new MessagingNotImplementedError('Messaging queue publisher is not configured');
        },
    enqueueMessageGenerate: dependencies?.enqueueMessageGenerate,
    logger: app.log,
  });

  app.post('/v1/messaging/drafts/generate', async (request, reply) => {
    const parsed = GenerateMessageDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid generate message payload');
    }

    try {
      const result = await service.generateMessageDraft(parsed.data);
      return GenerateMessageDraftResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/messaging/drafts', async (request, reply) => {
    const parsedQuery = ListMessageDraftsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid message drafts query');
    }

    try {
      const result = await service.listMessageDrafts(parsedQuery.data);
      return ListMessageDraftsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/messaging/drafts/events', async (request, reply) => {
    const parsedQuery = MessageDraftEventsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid message draft event query');
    }

    const target = parsedQuery.data;
    let subscription: PgNotificationSubscription | null = null;
    let cleanupStarted = false;
    let keepAlive: NodeJS.Timeout | null = null;
    let timeout: NodeJS.Timeout | null = null;

    const cleanup = async () => {
      if (cleanupStarted) {
        return;
      }
      cleanupStarted = true;
      if (keepAlive) {
        clearInterval(keepAlive);
      }
      if (timeout) {
        clearTimeout(timeout);
      }
      if (subscription) {
        await subscription.close();
      }
    };

    const closeWithEvent = (event: string, data: unknown) => {
      writeSseEvent(reply, event, data);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
      void cleanup();
    };

    reply.hijack();
    const streamHeaders: OutgoingHttpHeaders = {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    };
    reply.raw.writeHead(200, streamHeaders);
    reply.raw.write(': connected\n\n');

    request.raw.on('close', () => {
      void cleanup();
    });

    try {
      subscription = await listenToPgChannel(
        MESSAGE_DRAFT_EVENTS_CHANNEL,
        (notification) => {
          if (notification.channel !== MESSAGE_DRAFT_EVENTS_CHANNEL || !notification.payload) {
            return;
          }

          let payload: unknown;
          try {
            payload = JSON.parse(notification.payload);
          } catch {
            return;
          }

          const parsedEvent = MessageDraftEventPayloadSchema.safeParse(payload);
          if (!parsedEvent.success || !isMessageDraftEventTargetMatch(parsedEvent.data, target)) {
            return;
          }

          closeWithEvent('message-draft', parsedEvent.data);
        },
        (error) => {
          app.log.warn({ error }, 'Message draft event listener error');
          closeWithEvent('error', { error: 'Message draft notifications are unavailable.' });
        },
      );

      const existingDrafts = await service.listMessageDrafts({
        leadId: target.leadId,
        page: 1,
        pageSize: 20,
      });
      const existingDraft = existingDrafts.items.find((draft) => isDraftEventTargetMatch(draft, target));
      if (existingDraft) {
        closeWithEvent('message-draft', {
          type: 'message_draft',
          status: 'CREATED',
          leadId: existingDraft.leadId,
          icpProfileId: existingDraft.icpProfileId,
          draftId: existingDraft.id,
          followUpNumber: existingDraft.followUpNumber,
          createdAt: existingDraft.createdAt,
        } satisfies MessageDraftEventPayload);
        return;
      }

      keepAlive = setInterval(() => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) {
          reply.raw.write(': keepalive\n\n');
        }
      }, 15_000);
      timeout = setTimeout(() => {
        closeWithEvent('timeout', {
          leadId: target.leadId,
          message: 'Draft generation is still running.',
        });
      }, 120_000);
    } catch (error: unknown) {
      app.log.error({ error, leadId: target.leadId }, 'Failed to open message draft event stream');
      closeWithEvent('error', { error: 'Message draft notifications are unavailable.' });
    }
  });

  app.post('/v1/messaging/drafts/manual', async (request, reply) => {
    const parsed = CreateManualMessageDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid manual message draft payload');
    }

    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    try {
      const result = await service.createManualMessageDraft({
        ...parsed.data,
        approvedByUserId: userId,
      });
      return MessageDraftResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/messaging/drafts/:draftId', async (request, reply) => {
    const parsedParams = MessageDraftIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid message draft id');
    }

    try {
      const result = await service.getMessageDraft(parsedParams.data.draftId);
      return MessageDraftResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/messaging/drafts/:draftId/approve', async (request, reply) => {
    const parsedParams = MessageDraftIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid message draft id');
    }

    const parsedBody = ApproveMessageDraftRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, request.id, 'Invalid approve draft payload');
    }

    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    try {
      const result = await service.approveMessageDraft(parsedParams.data.draftId, {
        ...parsedBody.data,
        approvedByUserId: userId,
      });
      return MessageDraftResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/messaging/drafts/:draftId/reject', async (request, reply) => {
    const parsedParams = MessageDraftIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid message draft id');
    }

    const parsedBody = RejectMessageDraftRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, request.id, 'Invalid reject draft payload');
    }

    const userId = requireAuthenticatedUserId(request, reply);
    if (!userId) {
      return;
    }

    try {
      const result = await service.rejectMessageDraft(parsedParams.data.draftId, {
        ...parsedBody.data,
        rejectedByUserId: userId,
      });
      return MessageDraftResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.patch('/v1/messaging/variants/:variantId', async (request, reply) => {
    if (!(await requireAppAdminAccess(request, reply))) {
      return;
    }

    const parsedParams = MessageVariantIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid message variant id');
    }

    const parsedBody = UpdateMessageVariantRequestSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return sendValidationError(reply, request.id, 'Invalid update variant payload');
    }

    try {
      const result = await service.updateMessageVariant(
        parsedParams.data.variantId,
        parsedBody.data,
      );
      return MessageVariantResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.post('/v1/messaging/sends', async (request, reply) => {
    const parsed = SendMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid send message payload');
    }

    try {
      const result = await service.sendMessage(parsed.data);
      return MessageSendResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/messaging/sends', async (request, reply) => {
    const parsedQuery = ListMessageSendsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid message sends query');
    }

    try {
      const result = await service.listMessageSends(parsedQuery.data);
      return ListMessageSendsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/messaging/sends/:sendId', async (request, reply) => {
    const parsedParams = MessageSendIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid message send id');
    }

    try {
      const result = await service.getMessageSend(parsedParams.data.sendId);
      return MessageSendResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/messaging/conversations/:leadId', async (request, reply) => {
    const parsedParams = ConversationLeadIdParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return sendValidationError(reply, request.id, 'Invalid lead id');
    }

    try {
      const result = await service.getConversation(parsedParams.data.leadId);
      return ConversationResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
}
