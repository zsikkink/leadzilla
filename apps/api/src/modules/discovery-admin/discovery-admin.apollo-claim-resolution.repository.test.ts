import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  apolloRevealAttempt: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
  },
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
}));

describe('PrismaDiscoveryAdminRepository.resolveApolloRevealAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks a claimed Apollo attempt as abandoned', async () => {
    prismaMock.apolloRevealAttempt.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.apolloRevealAttempt.findUnique.mockResolvedValue({
      id: 'attempt_1',
      status: 'ABANDONED',
      claimedAt: new Date('2026-03-20T11:00:00.000Z'),
      completedAt: null,
      resolvedAt: new Date('2026-03-20T12:00:00.000Z'),
      resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      updatedAt: new Date('2026-03-20T12:00:00.000Z'),
    });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(
      repository.resolveApolloRevealAttempt(
        'attempt_1',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).resolves.toEqual({
      id: 'attempt_1',
      status: 'ABANDONED',
      claimedAt: '2026-03-20T11:00:00.000Z',
      completedAt: null,
      resolvedAt: '2026-03-20T12:00:00.000Z',
      resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-03-20T12:00:00.000Z',
    });

    expect(prismaMock.apolloRevealAttempt.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'attempt_1',
        status: 'CLAIMED',
      },
      data: {
        status: 'ABANDONED',
        resolvedAt: expect.any(Date),
        resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      },
    });
  });

  it('returns an already abandoned Apollo attempt without reopening it', async () => {
    prismaMock.apolloRevealAttempt.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.apolloRevealAttempt.findUnique.mockResolvedValue({
      id: 'attempt_1',
      status: 'ABANDONED',
      claimedAt: new Date('2026-03-20T11:00:00.000Z'),
      completedAt: null,
      resolvedAt: new Date('2026-03-20T12:00:00.000Z'),
      resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      updatedAt: new Date('2026-03-20T12:00:00.000Z'),
    });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(
      repository.resolveApolloRevealAttempt(
        'attempt_1',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).resolves.toEqual({
      id: 'attempt_1',
      status: 'ABANDONED',
      claimedAt: '2026-03-20T11:00:00.000Z',
      completedAt: null,
      resolvedAt: '2026-03-20T12:00:00.000Z',
      resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-03-20T12:00:00.000Z',
    });
  });

  it('rejects resolution for completed Apollo attempts', async () => {
    prismaMock.apolloRevealAttempt.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.apolloRevealAttempt.findUnique.mockResolvedValue({
      id: 'attempt_1',
      status: 'COMPLETED',
      claimedAt: new Date('2026-03-20T11:00:00.000Z'),
      completedAt: new Date('2026-03-20T11:10:00.000Z'),
      resolvedAt: null,
      resolvedByUserId: null,
      updatedAt: new Date('2026-03-20T11:10:00.000Z'),
    });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(
      repository.resolveApolloRevealAttempt(
        'attempt_1',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).rejects.toThrow('Apollo reveal attempt is already completed and cannot be resolved');
  });
});
