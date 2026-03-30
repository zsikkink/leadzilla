import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  jobRun: {
    create: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock('@lead-flood/db', () => ({
  Prisma: {},
  prisma: prismaMock,
  toInputJson: <T>(value: T) => value,
}));

describe('buildTriggerDiscoveryTaskRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.jobRun.create.mockResolvedValue({ id: 'job_run_1' });
    prismaMock.jobRun.update.mockResolvedValue({});
  });

  it('marks the parent job run FAILED when a later slot enqueue throws after an earlier slot was enqueued', async () => {
    const boss = {
      send: vi.fn()
        .mockResolvedValueOnce('slot_0')
        .mockRejectedValueOnce(new Error('slot 1 enqueue failed')),
    };

    const { buildTriggerDiscoveryTaskRun } = await import('./discovery-task-run.trigger.js');

    await expect(
      buildTriggerDiscoveryTaskRun(boss)({
        concurrency: 2,
        maxTasks: 5,
        timeBucket: 'weekday_morning',
      }),
    ).rejects.toThrow('slot 1 enqueue failed');

    expect(boss.send).toHaveBeenCalledTimes(2);
    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      'discovery.run_search_task',
      expect.objectContaining({
        slot: 0,
        jobRunId: 'job_run_1',
        correlationId: 'api:job_run:job_run_1',
        maxTasks: 5,
        timeBucket: 'weekday_morning',
      }),
      expect.objectContaining({
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
      }),
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      'discovery.run_search_task',
      expect.objectContaining({
        slot: 1,
        jobRunId: 'job_run_1',
      }),
      expect.any(Object),
    );
    expect(prismaMock.jobRun.update).toHaveBeenCalledWith({
      where: { id: 'job_run_1' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorText: 'slot 1 enqueue failed',
        finishedAt: expect.any(Date),
        durationMs: expect.any(Number),
      }),
    });
  });
});
