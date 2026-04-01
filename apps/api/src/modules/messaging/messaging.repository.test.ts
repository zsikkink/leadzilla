import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  $transaction: vi.fn(),
  messageDraft: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  messageVariant: {
    findUnique: vi.fn(),
  },
  messageSend: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
  },
  outboxEvent: {
    create: vi.fn(),
  },
};

class PrismaClientKnownRequestError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

vi.mock('@lead-flood/db', () => ({
  PrismaRuntime: {
    PrismaClientKnownRequestError,
    JsonNull: Symbol('JsonNull'),
  },
  toInputJson: (value: unknown) => value,
  prisma: prismaMock,
}));

function buildPrismaSend(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'send_1',
    leadId: 'lead_1',
    messageDraftId: 'draft_1',
    messageVariantId: 'variant_1',
    channel: 'EMAIL' as const,
    provider: 'RESEND' as const,
    providerMessageId: null,
    status: 'QUEUED' as const,
    idempotencyKey: 'approve:draft_1:variant_1',
    scheduledAt: null,
    sentAt: null,
    deliveredAt: null,
    repliedAt: null,
    followUpNumber: 0,
    nextFollowUpAfter: null,
    providerConversationId: null,
    failureCode: null,
    failureReason: null,
    createdAt: new Date('2026-03-21T00:00:00.000Z'),
    updatedAt: new Date('2026-03-21T01:00:00.000Z'),
    ...overrides,
  };
}

function buildPrismaVariant(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'variant_1',
    messageDraftId: 'draft_1',
    variantKey: 'variant_a',
    channel: 'EMAIL' as const,
    subject: 'Subject',
    bodyText: 'Hello',
    bodyHtml: null,
    ctaText: null,
    qualityScore: null,
    isSelected: true,
    createdAt: new Date('2026-03-20T00:00:00.000Z'),
    updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    ...overrides,
  };
}

function buildPrismaDraft(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 'draft_1',
    leadId: 'lead_1',
    icpProfileId: 'icp_1',
    scorePredictionId: 'score_1',
    promptVersion: 'v2',
    generatedByModel: 'stub',
    groundingKnowledgeIds: [],
    groundingContextJson: null,
    approvalStatus: 'PENDING' as 'PENDING' | 'APPROVED' | 'AUTO_APPROVED' | 'REJECTED',
    approvedByUserId: null as string | null,
    approvedAt: null as Date | null,
    rejectedReason: null,
    followUpNumber: 0,
    variants: [buildPrismaVariant()],
    createdAt: new Date('2026-03-20T00:00:00.000Z'),
    updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaMessagingRepository.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats UNRESOLVED initial sends as blocking and returns the existing send', async () => {
    prismaMock.messageVariant.findUnique.mockResolvedValue({
      channel: 'EMAIL',
      messageDraft: {
        id: 'draft_1',
        leadId: 'lead_1',
        followUpNumber: 0,
        approvalStatus: 'APPROVED',
      },
    });
    prismaMock.messageSend.findFirst.mockResolvedValue(
      buildPrismaSend({
        messageVariantId: 'variant_existing',
        status: 'UNRESOLVED',
        idempotencyKey: 'approve:draft_1:variant_existing',
      }),
    );

    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.sendMessage({
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_new',
        idempotencyKey: 'ui:draft_1:variant_new:123',
      }),
    ).resolves.toEqual({
      send: {
        id: 'send_1',
        leadId: 'lead_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_existing',
        channel: 'EMAIL',
        provider: 'RESEND',
        providerMessageId: null,
        status: 'UNRESOLVED',
        idempotencyKey: 'approve:draft_1:variant_existing',
        scheduledAt: null,
        sentAt: null,
        deliveredAt: null,
        repliedAt: null,
        followUpNumber: 0,
        nextFollowUpAfter: null,
        providerConversationId: null,
        failureCode: null,
        failureReason: null,
        createdAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T01:00:00.000Z',
      },
    });

    expect(prismaMock.messageSend.findFirst).toHaveBeenCalledWith({
      where: {
        messageDraftId: 'draft_1',
        followUpNumber: 0,
        status: { in: ['QUEUED', 'SENDING', 'UNRESOLVED', 'SENT', 'DELIVERED', 'REPLIED', 'BOUNCED'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.messageSend.create).not.toHaveBeenCalled();
  });

  it('creates a durable outbox intent in the same transaction as a new manual send', async () => {
    prismaMock.messageVariant.findUnique.mockResolvedValue({
      channel: 'EMAIL',
      messageDraft: {
        id: 'draft_1',
        leadId: 'lead_1',
        followUpNumber: 0,
        approvalStatus: 'APPROVED',
      },
    });
    prismaMock.messageSend.findFirst.mockResolvedValue(null);

    const tx = {
      messageSend: {
        create: vi.fn(async () =>
          buildPrismaSend({
            id: 'send_manual_1',
            idempotencyKey: 'ui:draft_1:variant_new:durable',
            messageVariantId: 'variant_new',
            updatedAt: new Date('2026-03-21T00:00:00.000Z'),
          }),
        ),
      },
      outboxEvent: {
        create: vi.fn(async () => ({ id: 'outbox_manual_1' })),
      },
    };
    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx as never));

    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.sendMessage({
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_new',
        idempotencyKey: 'ui:draft_1:variant_new:durable',
      }),
    ).resolves.toEqual({
      send: {
        id: 'send_manual_1',
        leadId: 'lead_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_new',
        channel: 'EMAIL',
        provider: 'RESEND',
        providerMessageId: null,
        status: 'QUEUED',
        idempotencyKey: 'ui:draft_1:variant_new:durable',
        scheduledAt: null,
        sentAt: null,
        deliveredAt: null,
        repliedAt: null,
        followUpNumber: 0,
        nextFollowUpAfter: null,
        providerConversationId: null,
        failureCode: null,
        failureReason: null,
        createdAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T00:00:00.000Z',
      },
      outboxEventId: 'outbox_manual_1',
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.messageSend.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_new',
        channel: 'EMAIL',
        provider: 'RESEND',
        status: 'QUEUED',
        idempotencyKey: 'ui:draft_1:variant_new:durable',
        followUpNumber: 0,
        scheduledAt: null,
      },
    });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        type: 'message.send',
        payload: {
          runId: 'send_manual_1',
          sendId: 'send_manual_1',
          messageDraftId: 'draft_1',
          messageVariantId: 'variant_new',
          idempotencyKey: 'ui:draft_1:variant_new:durable',
          channel: 'EMAIL',
        },
        status: 'pending',
      },
    });
  });
});

describe('PrismaMessagingRepository.approveMessageDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rolls back approval when the initial send outbox intent cannot be created', async () => {
    const draftState = buildPrismaDraft();
    const sendsState: Array<ReturnType<typeof buildPrismaSend>> = [];

    prismaMock.$transaction.mockImplementation(async (callback) => {
      let nextDraft = {
        ...draftState,
        variants: draftState.variants.map((variant) => ({ ...variant })),
      };
      const nextSends = sendsState.map((send) => ({ ...send }));

      const tx = {
        messageDraft: {
          findUnique: vi.fn(async () => nextDraft),
          update: vi.fn(async ({ data }: { data: { approvalStatus: 'APPROVED'; approvedByUserId: string; approvedAt: Date } }) => {
            nextDraft = {
              ...nextDraft,
              approvalStatus: data.approvalStatus,
              approvedByUserId: data.approvedByUserId,
              approvedAt: data.approvedAt,
            };
            return nextDraft;
          }),
        },
        messageVariant: {
          findUnique: vi.fn(),
          updateMany: vi.fn(),
          update: vi.fn(),
        },
        messageSend: {
          findFirst: vi.fn(async () => null),
          findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
            nextSends.find((send) => send.idempotencyKey === where.idempotencyKey) ?? null,
          ),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const send = buildPrismaSend({
              id: 'send_approval_1',
              leadId: data.leadId,
              messageDraftId: data.messageDraftId,
              messageVariantId: data.messageVariantId,
              channel: data.channel,
              provider: data.provider,
              idempotencyKey: data.idempotencyKey,
              followUpNumber: data.followUpNumber,
              scheduledAt: data.scheduledAt ?? null,
              updatedAt: new Date('2026-03-21T00:00:00.000Z'),
            });
            nextSends.push(send);
            return send;
          }),
        },
        outboxEvent: {
          create: vi.fn(async () => {
            throw new Error('outbox write failed');
          }),
        },
      };

      try {
        const result = await callback(tx as never);
        Object.assign(draftState, {
          ...nextDraft,
          variants: nextDraft.variants.map((variant) => ({ ...variant })),
        });
        sendsState.splice(0, sendsState.length, ...nextSends.map((send) => ({ ...send })));
        return result;
      } catch (error: unknown) {
        return Promise.reject(error);
      }
    });

    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.approveMessageDraft('draft_1', {
        approvedByUserId: 'user_1',
      }),
    ).rejects.toThrow('outbox write failed');

    expect(draftState.approvalStatus).toBe('PENDING');
    expect(draftState.approvedByUserId).toBeNull();
    expect(draftState.approvedAt).toBeNull();
    expect(sendsState).toHaveLength(0);
  });
});

describe('PrismaMessagingRepository.listMessageDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters follow-up drafts through the existing drafts query', async () => {
    prismaMock.messageDraft.count.mockResolvedValue(1);
    prismaMock.messageDraft.findMany.mockResolvedValue([
      {
        id: 'draft_fu_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
        promptVersion: 'v2',
        generatedByModel: 'stub',
        groundingKnowledgeIds: [],
        groundingContextJson: null,
        approvalStatus: 'APPROVED',
        approvedByUserId: 'user_1',
        approvedAt: new Date('2026-03-20T00:00:00.000Z'),
        rejectedReason: null,
        followUpNumber: 2,
        variants: [],
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
        updatedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    ]);

    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.listMessageDrafts({
        leadId: 'lead_1',
        followUpOnly: true,
        page: 1,
        pageSize: 20,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'draft_fu_1',
          leadId: 'lead_1',
          icpProfileId: 'icp_1',
          scorePredictionId: 'score_1',
          promptVersion: 'v2',
          generatedByModel: 'stub',
          groundingKnowledgeIds: [],
          groundingContextJson: null,
          approvalStatus: 'APPROVED',
          approvedByUserId: 'user_1',
          approvedAt: '2026-03-20T00:00:00.000Z',
          rejectedReason: null,
          followUpNumber: 2,
          variants: [],
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(prismaMock.messageDraft.count).toHaveBeenCalledWith({
      where: {
        leadId: 'lead_1',
        followUpNumber: { gt: 0 },
      },
    });
    expect(prismaMock.messageDraft.findMany).toHaveBeenCalledWith({
      where: {
        leadId: 'lead_1',
        followUpNumber: { gt: 0 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
      include: {
        variants: {
          orderBy: [{ variantKey: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  });
});
