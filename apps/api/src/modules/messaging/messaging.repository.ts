import type {
  ApproveMessageDraftRequest,
  ConversationEntry,
  ConversationResponse,
  GenerateMessageDraftRequest,
  GenerateMessageDraftResponse,
  ListMessageDraftsQuery,
  ListMessageDraftsResponse,
  ListMessageSendsQuery,
  ListMessageSendsResponse,
  MessageDraftResponse,
  MessageSendResponse,
  MessageSendStatus,
  MessageVariantResponse,
  RejectMessageDraftRequest,
  SendMessageRequest,
  UpdateMessageVariantRequest,
} from '@lead-flood/contracts';
import { PrismaRuntime, prisma, toInputJson, type Prisma } from '@lead-flood/db';

import {
  MessagingNotFoundError,
  MessagingNotImplementedError,
  MessagingSendIneligibleError,
} from './messaging.errors.js';

export interface CreateMessageSendForApprovalInput {
  leadId: string;
  messageDraftId: string;
  messageVariantId: string;
  channel: string;
  idempotencyKey: string;
  followUpNumber: number;
}

export interface DraftGenerationEligibilityContext {
  leadId: string;
  leadStatus: string;
  blendedScore: number | null;
}

export interface ExistingInitialDraft {
  draftId: string;
  variantIds: string[];
}

export interface MessageSendQueueIntentResult {
  send: MessageSendResponse;
  outboxEventId?: string | undefined;
}

export interface ApproveMessageDraftResult {
  draft: MessageDraftResponse;
  initialSend?: MessageSendQueueIntentResult | undefined;
}

export interface MessagingRepository {
  generateMessageDraft(input: GenerateMessageDraftRequest): Promise<GenerateMessageDraftResponse>;
  clearLeadDraftGenerationError(leadId: string): Promise<void>;
  getDraftGenerationEligibilityContext(
    input: Pick<GenerateMessageDraftRequest, 'leadId' | 'icpProfileId'>,
  ): Promise<DraftGenerationEligibilityContext | null>;
  markLeadDraftedIfQualified(leadId: string): Promise<void>;
  getExistingInitialDraft(
    input: Pick<GenerateMessageDraftRequest, 'leadId' | 'icpProfileId'>,
  ): Promise<ExistingInitialDraft | null>;
  supersedeInitialDraft(draftId: string): Promise<void>;
  getExistingInitialSendForDraft(draftId: string): Promise<MessageSendResponse | null>;
  listMessageDrafts(query: ListMessageDraftsQuery): Promise<ListMessageDraftsResponse>;
  getMessageDraft(draftId: string): Promise<MessageDraftResponse>;
  approveMessageDraft(draftId: string, input: ApproveMessageDraftRequest): Promise<ApproveMessageDraftResult>;
  rejectMessageDraft(draftId: string, input: RejectMessageDraftRequest): Promise<MessageDraftResponse>;
  sendMessage(input: SendMessageRequest): Promise<MessageSendQueueIntentResult>;
  listMessageSends(query: ListMessageSendsQuery): Promise<ListMessageSendsResponse>;
  getMessageSend(sendId: string): Promise<MessageSendResponse>;
  getConversation(leadId: string): Promise<ConversationResponse>;
  createMessageSendForApproval(input: CreateMessageSendForApprovalInput): Promise<MessageSendResponse>;
  updateMessageVariant(variantId: string, input: UpdateMessageVariantRequest): Promise<MessageVariantResponse>;
}

export class StubMessagingRepository implements MessagingRepository {
  async generateMessageDraft(_input: GenerateMessageDraftRequest): Promise<GenerateMessageDraftResponse> {
    throw new MessagingNotImplementedError('TODO: generate message draft persistence');
  }

  async clearLeadDraftGenerationError(_leadId: string): Promise<void> {
    throw new MessagingNotImplementedError('TODO: clear lead draft generation error');
  }

  async getDraftGenerationEligibilityContext(
    _input: Pick<GenerateMessageDraftRequest, 'leadId' | 'icpProfileId'>,
  ): Promise<DraftGenerationEligibilityContext | null> {
    throw new MessagingNotImplementedError('TODO: load draft generation eligibility context');
  }

  async markLeadDraftedIfQualified(_leadId: string): Promise<void> {
    throw new MessagingNotImplementedError('TODO: repair qualified lead status after existing initial draft lookup');
  }

  async getExistingInitialDraft(
    _input: Pick<GenerateMessageDraftRequest, 'leadId' | 'icpProfileId'>,
  ): Promise<ExistingInitialDraft | null> {
    throw new MessagingNotImplementedError('TODO: load existing initial draft');
  }

  async supersedeInitialDraft(_draftId: string): Promise<void> {
    throw new MessagingNotImplementedError('TODO: supersede existing initial draft');
  }

  async getExistingInitialSendForDraft(_draftId: string): Promise<MessageSendResponse | null> {
    throw new MessagingNotImplementedError('TODO: load existing initial send for draft');
  }

  async listMessageDrafts(_query: ListMessageDraftsQuery): Promise<ListMessageDraftsResponse> {
    throw new MessagingNotImplementedError('TODO: list message drafts persistence');
  }

  async getMessageDraft(_draftId: string): Promise<MessageDraftResponse> {
    throw new MessagingNotImplementedError('TODO: get message draft persistence');
  }

  async approveMessageDraft(
    _draftId: string,
    _input: ApproveMessageDraftRequest,
  ): Promise<ApproveMessageDraftResult> {
    throw new MessagingNotImplementedError('TODO: approve message draft persistence');
  }

  async rejectMessageDraft(
    _draftId: string,
    _input: RejectMessageDraftRequest,
  ): Promise<MessageDraftResponse> {
    throw new MessagingNotImplementedError('TODO: reject message draft persistence');
  }

  async sendMessage(_input: SendMessageRequest): Promise<MessageSendQueueIntentResult> {
    throw new MessagingNotImplementedError('TODO: send message persistence');
  }

  async listMessageSends(_query: ListMessageSendsQuery): Promise<ListMessageSendsResponse> {
    throw new MessagingNotImplementedError('TODO: list message sends persistence');
  }

  async getMessageSend(_sendId: string): Promise<MessageSendResponse> {
    throw new MessagingNotImplementedError('TODO: get message send persistence');
  }

  async getConversation(_leadId: string): Promise<ConversationResponse> {
    throw new MessagingNotImplementedError('TODO: get conversation persistence');
  }

  async createMessageSendForApproval(_input: CreateMessageSendForApprovalInput): Promise<MessageSendResponse> {
    throw new MessagingNotImplementedError('TODO: create message send for approval persistence');
  }

  async updateMessageVariant(_variantId: string, _input: UpdateMessageVariantRequest): Promise<MessageVariantResponse> {
    throw new MessagingNotImplementedError('TODO: update message variant persistence');
  }
}

type PrismaMessageVariant = {
  id: string;
  messageDraftId: string;
  variantKey: string;
  channel: 'EMAIL' | 'WHATSAPP';
  subject: string | null;
  bodyText: string;
  bodyHtml: string | null;
  ctaText: string | null;
  qualityScore: number | null;
  isSelected: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaMessageDraft = {
  id: string;
  leadId: string;
  icpProfileId: string;
  scorePredictionId: string | null;
  promptVersion: string;
  generatedByModel: string;
  groundingKnowledgeIds: string[];
  groundingContextJson: unknown;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
  approvedByUserId: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  followUpNumber: number;
  variants: PrismaMessageVariant[];
  createdAt: Date;
  updatedAt: Date;
};

type PrismaMessageSend = {
  id: string;
  leadId: string;
  messageDraftId: string;
  messageVariantId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  provider: 'RESEND' | 'TRENGO';
  providerMessageId: string | null;
  status: 'QUEUED' | 'SENDING' | 'UNRESOLVED' | 'SENT' | 'DELIVERED' | 'REPLIED' | 'BOUNCED' | 'FAILED';
  idempotencyKey: string;
  scheduledAt: Date | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  repliedAt: Date | null;
  followUpNumber: number;
  nextFollowUpAfter: Date | null;
  providerConversationId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function normalizeReplyClassification(value: string | null): string | null {
  if (value === 'UNSUBSCRIBE') {
    return 'NOT_INTERESTED';
  }
  return value;
}

function mapVariantToResponse(variant: PrismaMessageVariant): MessageVariantResponse {
  return {
    id: variant.id,
    messageDraftId: variant.messageDraftId,
    variantKey: variant.variantKey,
    channel: variant.channel,
    subject: variant.subject,
    bodyText: variant.bodyText,
    bodyHtml: variant.bodyHtml,
    ctaText: variant.ctaText,
    qualityScore: variant.qualityScore,
    isSelected: variant.isSelected,
    createdAt: variant.createdAt.toISOString(),
    updatedAt: variant.updatedAt.toISOString(),
  };
}

function mapDraftToResponse(draft: PrismaMessageDraft): MessageDraftResponse {
  return {
    id: draft.id,
    leadId: draft.leadId,
    icpProfileId: draft.icpProfileId,
    scorePredictionId: draft.scorePredictionId,
    promptVersion: draft.promptVersion,
    generatedByModel: draft.generatedByModel,
    groundingKnowledgeIds: draft.groundingKnowledgeIds,
    groundingContextJson:
      draft.groundingContextJson !== null && draft.groundingContextJson !== undefined
        ? draft.groundingContextJson
        : null,
    approvalStatus: draft.approvalStatus,
    approvedByUserId: draft.approvedByUserId,
    approvedAt: draft.approvedAt?.toISOString() ?? null,
    rejectedReason: draft.rejectedReason,
    followUpNumber: draft.followUpNumber,
    variants: draft.variants.map((variant) => mapVariantToResponse(variant)),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function mapSendToResponse(send: PrismaMessageSend): MessageSendResponse {
  return {
    id: send.id,
    leadId: send.leadId,
    messageDraftId: send.messageDraftId,
    messageVariantId: send.messageVariantId,
    channel: send.channel,
    provider: send.provider,
    providerMessageId: send.providerMessageId,
    status: send.status,
    idempotencyKey: send.idempotencyKey,
    scheduledAt: send.scheduledAt?.toISOString() ?? null,
    sentAt: send.sentAt?.toISOString() ?? null,
    deliveredAt: send.deliveredAt?.toISOString() ?? null,
    repliedAt: send.repliedAt?.toISOString() ?? null,
    followUpNumber: send.followUpNumber,
    nextFollowUpAfter: send.nextFollowUpAfter?.toISOString() ?? null,
    providerConversationId: send.providerConversationId,
    failureCode: send.failureCode,
    failureReason: send.failureReason,
    createdAt: send.createdAt.toISOString(),
    updatedAt: send.updatedAt.toISOString(),
  };
}

function variantsInclude() {
  return {
    variants: {
      orderBy: [{ variantKey: 'asc' as const }, { createdAt: 'asc' as const }],
    },
  };
}

type MessagingTransactionClient = Prisma.TransactionClient;

interface CreateQueuedMessageSendInput {
  leadId: string;
  messageDraftId: string;
  messageVariantId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  idempotencyKey: string;
  followUpNumber: number;
  scheduledAt?: Date | null | undefined;
}

function buildMessageSendOutboxPayload(send: PrismaMessageSend, runId: string) {
  return {
    runId,
    sendId: send.id,
    messageDraftId: send.messageDraftId,
    messageVariantId: send.messageVariantId,
    idempotencyKey: send.idempotencyKey,
    channel: send.channel,
    ...(send.scheduledAt ? { scheduledAt: send.scheduledAt.toISOString() } : {}),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function findExistingInitialSendForDraftTx(
  tx: MessagingTransactionClient,
  draftId: string,
): Promise<PrismaMessageSend | null> {
  return tx.messageSend.findFirst({
    where: {
      messageDraftId: draftId,
      followUpNumber: 0,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

async function findSendByIdempotencyKeyTx(
  tx: MessagingTransactionClient,
  idempotencyKey: string,
): Promise<PrismaMessageSend | null> {
  return tx.messageSend.findUnique({
    where: { idempotencyKey },
  });
}

async function createQueuedMessageSendWithOutbox(
  tx: MessagingTransactionClient,
  input: CreateQueuedMessageSendInput,
  buildRunId: (sendId: string) => string,
): Promise<MessageSendQueueIntentResult> {
  const send = await tx.messageSend.create({
    data: {
      leadId: input.leadId,
      messageDraftId: input.messageDraftId,
      messageVariantId: input.messageVariantId,
      channel: input.channel,
      provider: input.channel === 'WHATSAPP' ? 'TRENGO' : 'RESEND',
      status: 'QUEUED',
      idempotencyKey: input.idempotencyKey,
      followUpNumber: input.followUpNumber,
      scheduledAt: input.scheduledAt ?? null,
    },
  });

  const outboxEvent = await tx.outboxEvent.create({
    data: {
      type: 'message.send',
      payload: toInputJson(buildMessageSendOutboxPayload(send, buildRunId(send.id))),
      status: 'pending',
    },
  });

  return {
    send: mapSendToResponse(send),
    outboxEventId: outboxEvent.id,
  };
}

async function findExistingInitialSendForDraft(draftId: string): Promise<PrismaMessageSend | null> {
  return prisma.messageSend.findFirst({
    where: {
      messageDraftId: draftId,
      followUpNumber: 0,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

const BLOCKING_INITIAL_SEND_STATUSES: MessageSendStatus[] = [
  'QUEUED',
  'SENDING',
  'UNRESOLVED',
  'SENT',
  'DELIVERED',
  'REPLIED',
  'BOUNCED',
];

async function findBlockingInitialSendForDraft(draftId: string): Promise<PrismaMessageSend | null> {
  return prisma.messageSend.findFirst({
    where: {
      messageDraftId: draftId,
      followUpNumber: 0,
      status: { in: BLOCKING_INITIAL_SEND_STATUSES },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

export class PrismaMessagingRepository extends StubMessagingRepository {
  override async generateMessageDraft(
    input: GenerateMessageDraftRequest,
  ): Promise<GenerateMessageDraftResponse> {
    const draft = await prisma.messageDraft.create({
      data: {
        leadId: input.leadId,
        icpProfileId: input.icpProfileId,
        scorePredictionId: input.scorePredictionId ?? null,
        promptVersion: input.promptVersion,
        generatedByModel: 'stub',
        groundingKnowledgeIds: input.knowledgeEntryIds,
        groundingContextJson: PrismaRuntime.JsonNull,
        approvalStatus: 'PENDING',
        variants: {
          create: [
            {
              variantKey: 'variant_a',
              channel: input.channel,
              bodyText: 'TODO: LLM generation',
              isSelected: false,
            },
          ],
        },
      },
      include: variantsInclude(),
    });

    return {
      status: 'CREATED',
      draftId: draft.id,
      variantIds: draft.variants.map((variant) => variant.id),
    };
  }

  override async getDraftGenerationEligibilityContext(
    input: Pick<GenerateMessageDraftRequest, 'leadId' | 'icpProfileId'>,
  ): Promise<DraftGenerationEligibilityContext | null> {
    const lead = await prisma.lead.findFirst({
      where: {
        id: input.leadId,
        deletedAt: null,
      },
      select: { id: true, status: true },
    });

    if (!lead) {
      return null;
    }

    const scorePrediction = await prisma.leadScorePrediction.findFirst({
      where: {
        leadId: input.leadId,
        icpProfileId: input.icpProfileId,
      },
      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
      select: { blendedScore: true },
    });

    return {
      leadId: lead.id,
      leadStatus: lead.status,
      blendedScore: scorePrediction?.blendedScore ?? null,
    };
  }

  override async clearLeadDraftGenerationError(leadId: string): Promise<void> {
    await prisma.lead.updateMany({
      where: { id: leadId },
      data: { error: null },
    });
  }

  override async markLeadDraftedIfQualified(leadId: string): Promise<void> {
    await prisma.lead.updateMany({
      where: {
        id: leadId,
        status: 'qualified',
      },
      data: {
        status: 'drafted',
      },
    });
  }

  override async getExistingInitialDraft(
    input: Pick<GenerateMessageDraftRequest, 'leadId' | 'icpProfileId'>,
  ): Promise<ExistingInitialDraft | null> {
    const draft = await prisma.messageDraft.findFirst({
      where: {
        leadId: input.leadId,
        icpProfileId: input.icpProfileId,
        followUpNumber: 0,
        approvalStatus: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] },
      },
      include: variantsInclude(),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!draft) {
      return null;
    }

    return {
      draftId: draft.id,
      variantIds: draft.variants.map((variant) => variant.id),
    };
  }

  override async supersedeInitialDraft(draftId: string): Promise<void> {
    await prisma.messageDraft.update({
      where: { id: draftId },
      data: {
        approvalStatus: 'REJECTED',
        rejectedReason: 'Superseded by regenerated draft',
        approvedByUserId: null,
        approvedAt: null,
      },
    });
  }

  override async getExistingInitialSendForDraft(draftId: string): Promise<MessageSendResponse | null> {
    const send = await findExistingInitialSendForDraft(draftId);
    return send ? mapSendToResponse(send) : null;
  }

  override async listMessageDrafts(query: ListMessageDraftsQuery): Promise<ListMessageDraftsResponse> {
    const where = {
      ...(query.leadId !== undefined ? { leadId: query.leadId } : {}),
      ...(query.icpProfileId !== undefined ? { icpProfileId: query.icpProfileId } : {}),
      ...(query.approvalStatus !== undefined ? { approvalStatus: query.approvalStatus } : {}),
      ...(query.followUpOnly ? { followUpNumber: { gt: 0 } } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.messageDraft.count({ where }),
      prisma.messageDraft.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: variantsInclude(),
      }),
    ]);

    return {
      items: rows.map((row) => mapDraftToResponse(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  override async getMessageDraft(draftId: string): Promise<MessageDraftResponse> {
    const draft = await prisma.messageDraft.findUnique({
      where: { id: draftId },
      include: variantsInclude(),
    });
    if (!draft) {
      throw new MessagingNotFoundError('Message draft not found');
    }
    return mapDraftToResponse(draft);
  }

  override async approveMessageDraft(
    draftId: string,
    input: ApproveMessageDraftRequest,
  ): Promise<ApproveMessageDraftResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        const now = new Date();
        const existingDraft = await tx.messageDraft.findUnique({
          where: { id: draftId },
          include: variantsInclude(),
        });

        if (!existingDraft) {
          throw new MessagingNotFoundError('Message draft not found');
        }

        const isLockedInitialDraft =
          existingDraft.followUpNumber === 0 &&
          (existingDraft.approvalStatus === 'APPROVED' || existingDraft.approvalStatus === 'AUTO_APPROVED');

        if (input.selectedVariantId !== undefined) {
          const selectedVariant = await tx.messageVariant.findUnique({
            where: { id: input.selectedVariantId },
            select: { id: true, messageDraftId: true },
          });

          if (!selectedVariant) {
            throw new MessagingNotFoundError('Message variant not found');
          }

          if (selectedVariant.messageDraftId !== draftId) {
            throw new MessagingSendIneligibleError('Selected message variant does not belong to the requested draft.');
          }

          if (!isLockedInitialDraft) {
            await tx.messageVariant.updateMany({
              where: { messageDraftId: draftId },
              data: { isSelected: false },
            });
            await tx.messageVariant.update({
              where: { id: input.selectedVariantId },
              data: { isSelected: true },
            });
          }
        }

        const draft =
          isLockedInitialDraft
            ? (await tx.messageDraft.findUnique({
                where: { id: draftId },
                include: variantsInclude(),
              })) ?? existingDraft
            : await tx.messageDraft.update({
                where: { id: draftId },
                data: {
                  approvalStatus: 'APPROVED',
                  approvedByUserId: input.approvedByUserId,
                  approvedAt: now,
                },
                include: variantsInclude(),
              });

        const mappedDraft = mapDraftToResponse(draft);

        if (draft.approvalStatus !== 'APPROVED' || draft.variants.length === 0) {
          return { draft: mappedDraft };
        }

        const selectedVariant = draft.variants.find((variant) => variant.isSelected) ?? draft.variants[0];
        if (!selectedVariant) {
          return { draft: mappedDraft };
        }

        const existingInitialSend = await findExistingInitialSendForDraftTx(tx, draft.id);
        if (existingInitialSend) {
          return {
            draft: mappedDraft,
            initialSend: {
              send: mapSendToResponse(existingInitialSend),
            },
          };
        }

        const idempotencyKey = `approve:${draft.id}:${selectedVariant.id}`;

        try {
          const initialSend = await createQueuedMessageSendWithOutbox(
            tx,
            {
              leadId: draft.leadId,
              messageDraftId: draft.id,
              messageVariantId: selectedVariant.id,
              channel: selectedVariant.channel,
              idempotencyKey,
              followUpNumber: 0,
            },
            (sendId) => `message.send:${sendId}`,
          );

          return {
            draft: mappedDraft,
            initialSend,
          };
        } catch (error: unknown) {
          if (!isUniqueConstraintError(error)) {
            throw error;
          }

          const duplicateSend = await findSendByIdempotencyKeyTx(tx, idempotencyKey);
          if (!duplicateSend) {
            throw error;
          }

          return {
            draft: mappedDraft,
            initialSend: {
              send: mapSendToResponse(duplicateSend),
            },
          };
        }
      });
    } catch (error: unknown) {
      if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new MessagingNotFoundError('Message draft not found');
      }
      throw error;
    }
  }

  override async rejectMessageDraft(
    draftId: string,
    input: RejectMessageDraftRequest,
  ): Promise<MessageDraftResponse> {
    try {
      const draft = await prisma.messageDraft.update({
        where: { id: draftId },
        data: {
          approvalStatus: 'REJECTED',
          rejectedReason: input.rejectedReason,
        },
        include: variantsInclude(),
      });
      return mapDraftToResponse(draft);
    } catch (error: unknown) {
      if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new MessagingNotFoundError('Message draft not found');
      }
      throw error;
    }
  }

  override async sendMessage(input: SendMessageRequest): Promise<MessageSendQueueIntentResult> {
    const variant = await prisma.messageVariant.findUnique({
      where: { id: input.messageVariantId },
      select: {
        channel: true,
        messageDraft: {
          select: { id: true, leadId: true, followUpNumber: true, approvalStatus: true },
        },
      },
    });
    if (!variant) {
      throw new MessagingNotFoundError('Message variant not found');
    }

    if (variant.messageDraft.id !== input.messageDraftId) {
      throw new MessagingSendIneligibleError('Selected message variant does not belong to the requested draft.');
    }

    if (variant.messageDraft.followUpNumber === 0) {
      if (
        variant.messageDraft.approvalStatus !== 'APPROVED' &&
        variant.messageDraft.approvalStatus !== 'AUTO_APPROVED'
      ) {
        throw new MessagingSendIneligibleError('Initial draft must be approved before it can be sent.');
      }

      const existingInitialSend = await findBlockingInitialSendForDraft(input.messageDraftId);
      if (existingInitialSend) {
        return {
          send: mapSendToResponse(existingInitialSend),
        };
      }
    }

    return prisma.$transaction(async (tx) =>
      createQueuedMessageSendWithOutbox(
        tx,
        {
          leadId: variant.messageDraft.leadId,
          messageDraftId: input.messageDraftId,
          messageVariantId: input.messageVariantId,
          channel: variant.channel,
          idempotencyKey: input.idempotencyKey,
          followUpNumber: 0,
          scheduledAt: input.scheduledAt !== undefined ? new Date(input.scheduledAt) : null,
        },
        (sendId) => sendId,
      ),
    );
  }

  override async listMessageSends(query: ListMessageSendsQuery): Promise<ListMessageSendsResponse> {
    const where = {
      ...(query.leadId !== undefined ? { leadId: query.leadId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.channel !== undefined ? { channel: query.channel } : {}),
      ...(query.provider !== undefined ? { provider: query.provider } : {}),
      ...(query.from !== undefined || query.to !== undefined
        ? {
            createdAt: {
              ...(query.from !== undefined ? { gte: new Date(query.from) } : {}),
              ...(query.to !== undefined ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.messageSend.count({ where }),
      prisma.messageSend.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => mapSendToResponse(row)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  override async getMessageSend(sendId: string): Promise<MessageSendResponse> {
    const send = await prisma.messageSend.findUnique({
      where: { id: sendId },
    });
    if (!send) {
      throw new MessagingNotFoundError('Message send not found');
    }
    return mapSendToResponse(send);
  }

  override async getConversation(leadId: string): Promise<ConversationResponse> {
    // Sent messages: join MessageSend → MessageVariant (isSelected=true) for body text
    const sends = await prisma.messageSend.findMany({
      where: { leadId },
      include: {
        messageVariant: {
          select: { bodyText: true, bodyHtml: true, subject: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Replies: FeedbackEvents where eventType = REPLIED
    const replies = await prisma.feedbackEvent.findMany({
      where: { leadId, eventType: 'REPLIED' },
      orderBy: { occurredAt: 'asc' },
    });

    const entries: ConversationEntry[] = [];

    for (const send of sends) {
      entries.push({
        type: 'sent',
        timestamp: (send.sentAt ?? send.createdAt).toISOString(),
        channel: send.channel as 'EMAIL' | 'WHATSAPP',
        bodyText: send.messageVariant.bodyText,
        bodyHtml: send.messageVariant.bodyHtml ?? null,
        subject: send.messageVariant.subject ?? null,
        replyClassification: null,
        status: send.status as MessageSendStatus,
        followUpNumber: send.followUpNumber,
      });
    }

    for (const reply of replies) {
      entries.push({
        type: 'reply',
        timestamp: reply.occurredAt.toISOString(),
        channel: 'WHATSAPP', // Default — can refine later by looking at the linked MessageSend
        bodyText: reply.replyText ?? '(no text)',
        bodyHtml: null,
        subject: null,
        replyClassification: normalizeReplyClassification(reply.replyClassification),
        status: null,
        followUpNumber: null,
      });
    }

    // Sort chronologically
    entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return { leadId, entries };
  }

  override async updateMessageVariant(
    variantId: string,
    input: UpdateMessageVariantRequest,
  ): Promise<MessageVariantResponse> {
    try {
      const variant = await prisma.messageVariant.update({
        where: { id: variantId },
        data: {
          bodyText: input.bodyText,
          ...(input.subject !== undefined ? { subject: input.subject } : {}),
        },
      });
      return mapVariantToResponse(variant);
    } catch (error: unknown) {
      if (error instanceof PrismaRuntime.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new MessagingNotFoundError('Message variant not found');
      }
      throw error;
    }
  }

  override async createMessageSendForApproval(
    input: CreateMessageSendForApprovalInput,
  ): Promise<MessageSendResponse> {
    const existingSend = await findExistingInitialSendForDraft(input.messageDraftId);
    if (existingSend) {
      return mapSendToResponse(existingSend);
    }

    const send = await prisma.messageSend.create({
      data: {
        leadId: input.leadId,
        messageDraftId: input.messageDraftId,
        messageVariantId: input.messageVariantId,
        channel: input.channel === 'WHATSAPP' ? 'WHATSAPP' : 'EMAIL',
        provider: input.channel === 'WHATSAPP' ? 'TRENGO' : 'RESEND',
        status: 'QUEUED',
        idempotencyKey: input.idempotencyKey,
        followUpNumber: input.followUpNumber,
      },
    });

    return mapSendToResponse(send);
  }
}
