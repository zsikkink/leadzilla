import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  jobExecution: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  searchTask: {
    updateMany: vi.fn(),
  },
  discoveryCostEvent: {
    findMany: vi.fn(),
  },
  $queryRawUnsafe: vi.fn(),
  $executeRawUnsafe: vi.fn(),
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
}));

describe('PrismaDiscoveryAdminRepository.cancelDiscoveryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PG_BOSS_SCHEMA = 'pgboss';
  });

  it('marks the run cancelled and removes pending pg-boss discovery jobs', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({ status: 'queued', result: null });
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ deleted_count: 3 }]);
    prismaMock.searchTask.updateMany.mockResolvedValue({ count: 2 });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.cancelDiscoveryRun('run_123')).resolves.toEqual({
      success: true,
      outcome: 'cancelled',
      terminalStatus: 'cancelled',
      cancelledPendingJobsCount: 3,
    });

    expect(prismaMock.jobExecution.update).toHaveBeenCalledWith({
      where: { id: 'run_123' },
      data: {
        status: 'cancelled',
        finishedAt: expect.any(Date),
        result: expect.objectContaining({
          cancellation: expect.objectContaining({
            outcome: 'cancelled',
            cancelledPendingJobsCount: 3,
          }),
        }),
      },
    });
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("delete from pgboss.job"),
      'run_123',
      'run_123',
      '%run_123%',
    );
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("state in ('created', 'retry', 'active')"),
      'run_123',
      'run_123',
      '%run_123%',
    );
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("'business.prequalify'"),
      'run_123',
      'run_123',
      '%run_123%',
    );
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("'business.convert'"),
      'run_123',
      'run_123',
      '%run_123%',
    );
    expect(prismaMock.searchTask.updateMany).toHaveBeenCalledWith({
      where: {
        discoveryRunId: 'run_123',
        status: { in: ['PENDING', 'RUNNING'] },
      },
      data: {
        status: 'FAILED',
        error: 'Cancelled: discovery run was cancelled',
      },
    });
  });

  it('returns success when the run is already cancelled', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({ status: 'cancelled' });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.cancelDiscoveryRun('run_123')).resolves.toEqual({
      success: true,
      outcome: 'already_cancelled',
      terminalStatus: 'cancelled',
      cancelledPendingJobsCount: 0,
    });

    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns outcome already_terminal for completed/failed runs', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({ status: 'completed' });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.cancelDiscoveryRun('run_123')).resolves.toEqual({
      success: false,
      outcome: 'already_terminal',
      terminalStatus: 'completed',
      cancelledPendingJobsCount: 0,
    });
    expect(prismaMock.jobExecution.update).not.toHaveBeenCalled();
  });

  it('returns already_terminal instead of throwing when cancellation races with terminal finalization', async () => {
    prismaMock.jobExecution.findUnique
      .mockResolvedValueOnce({ status: 'running', result: null })
      .mockResolvedValueOnce({ status: 'completed' });
    prismaMock.$queryRawUnsafe.mockResolvedValue([{ deleted_count: 1 }]);
    prismaMock.jobExecution.update.mockRejectedValue(new Error('concurrent update'));

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.cancelDiscoveryRun('run_123')).resolves.toEqual({
      success: false,
      outcome: 'already_terminal',
      terminalStatus: 'completed',
      cancelledPendingJobsCount: 1,
    });
  });
});

describe('PrismaDiscoveryAdminRepository.getDiscoveryRunDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only non-rejected converted leads in the converted section', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({
      id: 'run_123',
      type: 'discovery.run',
      status: 'completed',
      attempts: 1,
      payload: {},
      result: {},
      error: null,
      createdAt: new Date('2026-03-09T00:00:00.000Z'),
      startedAt: new Date('2026-03-09T00:01:00.000Z'),
      finishedAt: new Date('2026-03-09T00:02:00.000Z'),
      updatedAt: new Date('2026-03-09T00:02:00.000Z'),
    });
    prismaMock.discoveryCostEvent.findMany.mockResolvedValue([
      {
        business: {
          id: 'biz_1',
          name: 'Alpha Co',
          businessConversions: [
            {
              lead: {
                id: 'lead_ok',
                firstName: 'Ava',
                lastName: 'Jones',
                status: 'qualified',
                business: { name: 'Alpha Co' },
              },
            },
            {
              lead: {
                id: 'lead_rejected',
                firstName: 'Bob',
                lastName: 'Smith',
                status: 'rejected',
                business: { name: 'Alpha Co' },
              },
            },
          ],
        },
      },
    ]);

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.getDiscoveryRunDetail('run_123')).resolves.toEqual(
      expect.objectContaining({
        leads: [
          {
            id: 'lead_ok',
            firstName: 'Ava',
            lastName: 'Jones',
            companyName: 'Alpha Co',
          },
        ],
      }),
    );
  });
});
