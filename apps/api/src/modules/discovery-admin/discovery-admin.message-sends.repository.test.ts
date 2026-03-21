import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  messageSend: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
}));

describe('PrismaDiscoveryAdminRepository.listStaleMessageSends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-21T02:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns paginated stale SENDING message sends', async () => {
    prismaMock.messageSend.count.mockResolvedValue(1);
    prismaMock.messageSend.findMany.mockResolvedValue([
      {
        id: 'send_1',
        leadId: 'lead_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        channel: 'WHATSAPP',
        provider: 'TRENGO',
        status: 'SENDING',
        idempotencyKey: 'approve:draft_1:variant_1',
        providerMessageId: null,
        providerConversationId: 'ticket_42',
        scheduledAt: null,
        sentAt: null,
        followUpNumber: 0,
        createdAt: new Date('2026-03-21T01:00:00.000Z'),
        updatedAt: new Date('2026-03-21T01:15:00.000Z'),
        lead: {
          email: 'ava@example.com',
          firstName: 'Ava',
          lastName: 'Jones',
          business: {
            name: 'Alpha Co',
          },
        },
      },
    ]);

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(
      repository.listStaleMessageSends({
        page: 1,
        pageSize: 20,
        olderThanMinutes: 30,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'send_1',
          leadId: 'lead_1',
          leadEmail: 'ava@example.com',
          leadFirstName: 'Ava',
          leadLastName: 'Jones',
          businessName: 'Alpha Co',
          messageDraftId: 'draft_1',
          messageVariantId: 'variant_1',
          channel: 'WHATSAPP',
          provider: 'TRENGO',
          status: 'SENDING',
          idempotencyKey: 'approve:draft_1:variant_1',
          providerMessageId: null,
          providerConversationId: 'ticket_42',
          scheduledAt: null,
          sentAt: null,
          followUpNumber: 0,
          createdAt: '2026-03-21T01:00:00.000Z',
          updatedAt: '2026-03-21T01:15:00.000Z',
          sendingAgeMinutes: 45,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(prismaMock.messageSend.count).toHaveBeenCalledWith({
      where: {
        status: 'SENDING',
        updatedAt: { lt: new Date('2026-03-21T01:30:00.000Z') },
      },
    });
    expect(prismaMock.messageSend.findMany).toHaveBeenCalledWith({
      where: {
        status: 'SENDING',
        updatedAt: { lt: new Date('2026-03-21T01:30:00.000Z') },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 20,
      select: {
        id: true,
        leadId: true,
        messageDraftId: true,
        messageVariantId: true,
        channel: true,
        provider: true,
        status: true,
        idempotencyKey: true,
        providerMessageId: true,
        providerConversationId: true,
        scheduledAt: true,
        sentAt: true,
        followUpNumber: true,
        createdAt: true,
        updatedAt: true,
        lead: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            business: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
  });
});
