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
  prisma: prismaMock,
}));

import { MessagingOutboundDisabledError } from './messaging.errors.js';

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

  it('rejects manual sends before variant lookup, send creation, or outbox creation', async () => {
    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.sendMessage({
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_new',
        idempotencyKey: 'ui:draft_1:variant_new:durable',
      }),
    ).rejects.toThrow(MessagingOutboundDisabledError);

    expect(prismaMock.messageVariant.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.messageSend.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.messageSend.create).not.toHaveBeenCalled();
    expect(prismaMock.outboxEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('rejects approval-created sends before persistence writes', async () => {
    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.createMessageSendForApproval({
        leadId: 'lead_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        channel: 'EMAIL',
        idempotencyKey: 'approve:draft_1:variant_1',
        followUpNumber: 0,
      }),
    ).rejects.toThrow(MessagingOutboundDisabledError);

    expect(prismaMock.messageSend.create).not.toHaveBeenCalled();
    expect(prismaMock.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('PrismaMessagingRepository.approveMessageDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves the draft without creating MessageSend or outbox rows', async () => {
    const tx = {
      messageDraft: {
        findUnique: vi.fn(async () => buildPrismaDraft()),
        update: vi.fn(async ({ data }: { data: { approvalStatus: 'APPROVED'; approvedByUserId: string; approvedAt: Date } }) =>
          buildPrismaDraft({
            approvalStatus: data.approvalStatus,
            approvedByUserId: data.approvedByUserId,
            approvedAt: data.approvedAt,
          }),
        ),
      },
      messageVariant: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      messageSend: {
        create: vi.fn(),
      },
      outboxEvent: {
        create: vi.fn(),
      },
    };
    prismaMock.$transaction.mockImplementation(async (callback) => callback(tx as never));

    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.approveMessageDraft('draft_1', {
        approvedByUserId: 'user_1',
      }),
    ).resolves.toMatchObject({
      draft: {
        id: 'draft_1',
        approvalStatus: 'APPROVED',
        approvedByUserId: 'user_1',
      },
    });

    expect(tx.messageSend.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
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
