import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  jobExecution: {
    findUnique: vi.fn(),
    update: vi.fn(),
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
      expect.stringContaining("state in ('created', 'retry')"),
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
