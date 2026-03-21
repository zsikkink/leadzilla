import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  messageSend: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
}));

describe('PrismaDiscoveryAdminRepository.resolveMessageSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a SENDING message send as UNRESOLVED', async () => {
    prismaMock.messageSend.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.messageSend.findUnique.mockResolvedValue({
      id: 'send_1',
      status: 'UNRESOLVED',
      providerMessageId: null,
      providerConversationId: 'ticket_42',
      sentAt: null,
      updatedAt: new Date('2026-03-21T12:00:00.000Z'),
    });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.resolveMessageSend('send_1')).resolves.toEqual({
      id: 'send_1',
      status: 'UNRESOLVED',
      providerMessageId: null,
      providerConversationId: 'ticket_42',
      sentAt: null,
      updatedAt: '2026-03-21T12:00:00.000Z',
    });

    expect(prismaMock.messageSend.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_1',
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
      },
    });
  });

  it('returns an already unresolved send without reopening it', async () => {
    prismaMock.messageSend.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.messageSend.findUnique.mockResolvedValue({
      id: 'send_1',
      status: 'UNRESOLVED',
      providerMessageId: 'provider_1',
      providerConversationId: 'ticket_42',
      sentAt: new Date('2026-03-21T11:50:00.000Z'),
      updatedAt: new Date('2026-03-21T12:00:00.000Z'),
    });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.resolveMessageSend('send_1')).resolves.toEqual({
      id: 'send_1',
      status: 'UNRESOLVED',
      providerMessageId: 'provider_1',
      providerConversationId: 'ticket_42',
      sentAt: '2026-03-21T11:50:00.000Z',
      updatedAt: '2026-03-21T12:00:00.000Z',
    });
  });

  it('rejects resolution for sends no longer in SENDING', async () => {
    prismaMock.messageSend.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.messageSend.findUnique.mockResolvedValue({
      id: 'send_1',
      status: 'DELIVERED',
      providerMessageId: 'provider_1',
      providerConversationId: null,
      sentAt: new Date('2026-03-21T11:40:00.000Z'),
      updatedAt: new Date('2026-03-21T11:45:00.000Z'),
    });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.resolveMessageSend('send_1')).rejects.toThrow(
      'Message send is no longer in SENDING and cannot be quarantined',
    );
  });
});
