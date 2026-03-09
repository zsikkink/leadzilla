import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  jobExecution: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $executeRawUnsafe: vi.fn(),
  $transaction: vi.fn(),
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
    prismaMock.jobExecution.findUnique.mockResolvedValue({ status: 'queued' });
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<void>) =>
      callback(prismaMock),
    );

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.cancelDiscoveryRun('run_123')).resolves.toEqual({ success: true });

    expect(prismaMock.jobExecution.update).toHaveBeenCalledWith({
      where: { id: 'run_123' },
      data: {
        status: 'cancelled',
        finishedAt: expect.any(Date),
      },
    });
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("delete from pgboss.job"),
      'run_123',
      '%run_123%',
    );
  });

  it('returns success when the run is already cancelled', async () => {
    prismaMock.jobExecution.findUnique.mockResolvedValue({ status: 'cancelled' });

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(repository.cancelDiscoveryRun('run_123')).resolves.toEqual({ success: true });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
