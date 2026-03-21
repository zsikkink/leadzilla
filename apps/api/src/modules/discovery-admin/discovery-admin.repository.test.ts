import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  jobExecution: {
    findFirst: vi.fn(),
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
    prismaMock.jobExecution.findFirst.mockResolvedValue({ status: 'queued', result: null });
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
    prismaMock.jobExecution.findFirst.mockResolvedValue({ status: 'cancelled' });

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
    prismaMock.jobExecution.findFirst.mockResolvedValue({ status: 'completed' });

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
    prismaMock.jobExecution.findFirst
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

  it('treats non-owned discovery runs as not found', async () => {
    prismaMock.jobExecution.findFirst.mockResolvedValue(null);

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(
      repository.cancelDiscoveryRun('run_123', '11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('Discovery run not found');

    expect(prismaMock.jobExecution.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'run_123',
        payload: {
          path: ['requestedByUserId'],
          equals: '11111111-1111-4111-8111-111111111111',
        },
      },
      select: { status: true, result: true },
    });
    expect(prismaMock.jobExecution.update).not.toHaveBeenCalled();
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
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

describe('PrismaDiscoveryAdminRepository.listJobRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated job requests with optional filters', async () => {
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([
        {
          id: 21,
          request_type: 'DISCOVERY_RUN',
          status: 'PENDING',
          params_json: { maxTasks: 40 },
          requested_by: 'user_1',
          claimed_by: null,
          created_at: new Date('2026-03-14T12:00:00.000Z'),
          updated_at: new Date('2026-03-14T12:01:00.000Z'),
          claimed_at: null,
          started_at: null,
          finished_at: null,
          error_text: null,
          job_run_id: null,
          idempotency_key: 'idem_1',
        },
        {
          id: 20,
          request_type: 'DISCOVERY_RUN',
          status: 'PENDING',
          params_json: { maxTasks: 20 },
          requested_by: 'user_2',
          claimed_by: 'worker_1',
          created_at: new Date('2026-03-14T11:00:00.000Z'),
          updated_at: new Date('2026-03-14T11:05:00.000Z'),
          claimed_at: new Date('2026-03-14T11:01:00.000Z'),
          started_at: new Date('2026-03-14T11:02:00.000Z'),
          finished_at: null,
          error_text: null,
          job_run_id: 'run_20',
          idempotency_key: 'idem_2',
        },
      ]);

    const { PrismaDiscoveryAdminRepository } = await import('./discovery-admin.repository.js');
    const repository = new PrismaDiscoveryAdminRepository();

    await expect(
      repository.listJobRequests({
        page: 1,
        pageSize: 20,
        status: 'PENDING',
        requestType: 'DISCOVERY_RUN',
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 21,
          requestType: 'DISCOVERY_RUN',
          status: 'PENDING',
          paramsJson: { maxTasks: 40 },
          requestedBy: 'user_1',
          claimedBy: null,
          createdAt: '2026-03-14T12:00:00.000Z',
          updatedAt: '2026-03-14T12:01:00.000Z',
          claimedAt: null,
          startedAt: null,
          finishedAt: null,
          errorText: null,
          jobRunId: null,
          idempotencyKey: 'idem_1',
        },
        {
          id: 20,
          requestType: 'DISCOVERY_RUN',
          status: 'PENDING',
          paramsJson: { maxTasks: 20 },
          requestedBy: 'user_2',
          claimedBy: 'worker_1',
          createdAt: '2026-03-14T11:00:00.000Z',
          updatedAt: '2026-03-14T11:05:00.000Z',
          claimedAt: '2026-03-14T11:01:00.000Z',
          startedAt: '2026-03-14T11:02:00.000Z',
          finishedAt: null,
          errorText: null,
          jobRunId: 'run_20',
          idempotencyKey: 'idem_2',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });

    expect(prismaMock.$queryRawUnsafe).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('from public.job_requests'),
      'PENDING',
      'DISCOVERY_RUN',
    );
    expect(prismaMock.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('order by created_at desc, id desc'),
      'PENDING',
      'DISCOVERY_RUN',
      20,
      0,
    );
  });
});
