import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  apolloRevealAttempt: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
}));

describe('PrismaDiscoveryAdminRepository.listStaleApolloRevealAttempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-20T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns paginated stale claimed Apollo reveal attempts', async () => {
    prismaMock.apolloRevealAttempt.count.mockResolvedValue(1);
    prismaMock.apolloRevealAttempt.findMany.mockResolvedValue([
      {
        id: 'attempt_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        scorePredictionId: 'score_1',
        discoveryRunId: 'run_1',
        status: 'CLAIMED',
        jobId: 'job_1',
        claimedAt: new Date('2026-03-20T11:00:00.000Z'),
        completedAt: null,
        createdAt: new Date('2026-03-20T11:00:00.000Z'),
        updatedAt: new Date('2026-03-20T11:00:00.000Z'),
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
      repository.listStaleApolloRevealAttempts({
        page: 1,
        pageSize: 20,
        olderThanMinutes: 30,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 'attempt_1',
          leadId: 'lead_1',
          leadEmail: 'ava@example.com',
          leadFirstName: 'Ava',
          leadLastName: 'Jones',
          businessName: 'Alpha Co',
          icpProfileId: 'icp_1',
          scorePredictionId: 'score_1',
          discoveryRunId: 'run_1',
          status: 'CLAIMED',
          jobId: 'job_1',
          claimedAt: '2026-03-20T11:00:00.000Z',
          completedAt: null,
          createdAt: '2026-03-20T11:00:00.000Z',
          updatedAt: '2026-03-20T11:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(prismaMock.apolloRevealAttempt.count).toHaveBeenCalledWith({
      where: {
        status: 'CLAIMED',
        claimedAt: { lt: new Date('2026-03-20T11:30:00.000Z') },
      },
    });
    expect(prismaMock.apolloRevealAttempt.findMany).toHaveBeenCalledWith({
      where: {
        status: 'CLAIMED',
        claimedAt: { lt: new Date('2026-03-20T11:30:00.000Z') },
      },
      orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 20,
      select: {
        id: true,
        leadId: true,
        icpProfileId: true,
        scorePredictionId: true,
        discoveryRunId: true,
        status: true,
        jobId: true,
        claimedAt: true,
        completedAt: true,
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
