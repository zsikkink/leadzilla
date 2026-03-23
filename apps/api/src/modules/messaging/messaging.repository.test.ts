import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
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
  },
};

vi.mock('@lead-flood/db', () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;

      constructor(code: string) {
        super(code);
        this.code = code;
      }
    },
  },
  prisma: prismaMock,
}));

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
    prismaMock.messageSend.findFirst.mockResolvedValue({
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
      createdAt: new Date('2026-03-21T00:00:00.000Z'),
      updatedAt: new Date('2026-03-21T01:00:00.000Z'),
    });

    const { PrismaMessagingRepository } = await import('./messaging.repository.js');
    const repository = new PrismaMessagingRepository();

    await expect(
      repository.sendMessage({
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_new',
        idempotencyKey: 'ui:draft_1:variant_new:123',
      }),
    ).resolves.toEqual({
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
    });

    expect(prismaMock.messageSend.findFirst).toHaveBeenCalledWith({
      where: {
        messageDraftId: 'draft_1',
        followUpNumber: 0,
        status: { in: ['QUEUED', 'SENDING', 'UNRESOLVED', 'SENT', 'DELIVERED', 'REPLIED', 'BOUNCED'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(prismaMock.messageSend.create).not.toHaveBeenCalled();
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
