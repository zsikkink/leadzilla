import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
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
