import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ErrorResponseSchema,
  FeedbackSummaryQuerySchema,
  FeedbackSummaryResponseSchema,
  IngestFeedbackEventRequestSchema,
  IngestFeedbackEventResponseSchema,
  ListFeedbackEventsQuerySchema,
  ListFeedbackEventsResponseSchema,
} from '@lead-flood/contracts';

import { requireAppAdminAccess } from '../../auth/guard.js';
import { FeedbackNotImplementedError } from './feedback.errors.js';
import { PrismaFeedbackRepository } from './feedback.repository.js';
import { buildFeedbackService, FeedbackLeadNotFoundError } from './feedback.service.js';

function sendValidationError(reply: FastifyReply, requestId: string, message: string) {
  reply.status(400);
  return ErrorResponseSchema.parse({
    error: message,
    requestId,
  });
}

function handleModuleError(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof FeedbackLeadNotFoundError) {
    reply.status(404).send(
      ErrorResponseSchema.parse({
        error: error.message,
        requestId: request.id,
      }),
    );
    return true;
  }

  if (error instanceof FeedbackNotImplementedError) {
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

export function registerFeedbackRoutes(app: FastifyInstance): void {
  const repository = new PrismaFeedbackRepository();
  const service = buildFeedbackService(repository);
  const requireAppAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireAppAdminAccess(request, reply))) {
      return reply;
    }
  };

  app.post('/v1/feedback/events', { preHandler: requireAppAdmin }, async (request, reply) => {
    const parsed = IngestFeedbackEventRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, request.id, 'Invalid feedback event payload');
    }

    try {
      const result = await service.ingestFeedbackEvent(parsed.data);
      return IngestFeedbackEventResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/feedback/events', async (request, reply) => {
    const parsedQuery = ListFeedbackEventsQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid feedback events query');
    }

    try {
      const result = await service.listFeedbackEvents(parsedQuery.data);
      return ListFeedbackEventsResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.delete('/v1/feedback/events/:eventId', { preHandler: requireAppAdmin }, async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    if (!eventId) {
      return sendValidationError(reply, request.id, 'Missing eventId parameter');
    }

    try {
      const deleted = await service.deleteFeedbackEvent(eventId);
      if (!deleted) {
        reply.status(404).send(
          ErrorResponseSchema.parse({
            error: `Feedback event not found: ${eventId}`,
            requestId: request.id,
          }),
        );
        return;
      }
      reply.status(204).send();
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });

  app.get('/v1/feedback/summary', async (request, reply) => {
    const parsedQuery = FeedbackSummaryQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return sendValidationError(reply, request.id, 'Invalid feedback summary query');
    }

    try {
      const result = await service.getFeedbackSummary(parsedQuery.data);
      return FeedbackSummaryResponseSchema.parse(result);
    } catch (error: unknown) {
      if (handleModuleError(error, request, reply)) {
        return;
      }
      throw error;
    }
  });
}
