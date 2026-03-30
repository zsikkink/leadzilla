import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { discoveryMock, dbMock, trackerMock } = vi.hoisted(() => ({
  discoveryMock: {
    getMetricSnapshot: vi.fn(() => ({})),
    logDiscoveryEvent: vi.fn(),
    runSearchTask: vi.fn(),
  },
  dbMock: {
    prisma: {
      jobRun: {
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      jobExecution: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      businessConversion: {
        findMany: vi.fn(),
      },
    },
  },
  trackerMock: {
    markSearchTasksComplete: vi.fn(),
    tryFinalizeDiscoveryRun: vi.fn(),
    isLeadTargetReached: vi.fn(),
  },
}));

vi.mock('@lead-flood/discovery', () => ({
  getMetricSnapshot: discoveryMock.getMetricSnapshot,
  logDiscoveryEvent: discoveryMock.logDiscoveryEvent,
  runSearchTask: discoveryMock.runSearchTask,
}));

vi.mock('@lead-flood/db', () => ({
  Prisma: {},
  prisma: dbMock.prisma,
  toInputJson: (value: unknown) => value,
}));

vi.mock('../utils/discovery-run-tracker.js', () => ({
  markSearchTasksComplete: trackerMock.markSearchTasksComplete,
  tryFinalizeDiscoveryRun: trackerMock.tryFinalizeDiscoveryRun,
  isLeadTargetReached: trackerMock.isLeadTargetReached,
}));

import {
  handleDiscoveryRunSearchTaskJob,
  type DiscoveryRunSearchTaskJobPayload,
} from './discovery.run_search_task.job.js';

function makeJob(data: DiscoveryRunSearchTaskJobPayload): Job<DiscoveryRunSearchTaskJobPayload> {
  return {
    id: randomUUID(),
    name: 'discovery.run_search_task',
    data,
  } as Job<DiscoveryRunSearchTaskJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleDiscoveryRunSearchTaskJob rediscovery reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    discoveryMock.runSearchTask.mockResolvedValue({
      taskId: 'task_1',
      status: 'DONE',
      taskType: 'SERP_GOOGLE_LOCAL',
      queryHash: 'query_hash_1',
      countryCode: 'US',
      language: 'en',
      durationMs: 125,
      newBusinesses: 0,
      newBusinessIds: [],
      observedBusinessIds: ['business_1'],
      newSources: 0,
      localBusinessCount: 1,
      organicResultCount: 0,
      attempts: 1,
    });
    dbMock.prisma.jobExecution.findUnique.mockResolvedValue({
      result: {},
    });
    dbMock.prisma.jobExecution.updateMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.jobRun.update.mockResolvedValue({});
    dbMock.prisma.jobRun.updateMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.businessConversion.findMany.mockResolvedValue([]);
    trackerMock.isLeadTargetReached.mockResolvedValue(false);
    trackerMock.markSearchTasksComplete.mockResolvedValue(undefined);
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
  });

  it('enqueues business.prequalify for an existing observed business instead of reconciling it in the search worker', async () => {
    const enqueueBusinessPrequalify = vi.fn();

    await handleDiscoveryRunSearchTaskJob(
      logger,
      makeJob({
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_2',
      }),
      {
        boss: { send: vi.fn() },
        provider: {} as never,
        config: {} as never,
        enqueueBusinessPrequalify,
      },
    );

    expect(enqueueBusinessPrequalify).toHaveBeenCalledWith({
      businessId: 'business_1',
      discoveryRunId: 'run_1',
      icpProfileId: 'icp_2',
      correlationId: expect.any(String),
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        observedExistingBusinessCount: 1,
        discoveryRunId: 'run_1',
        icpProfileId: 'icp_2',
        enqueuedPrequalifyCount: 1,
      }),
      'Enqueued business.prequalify for existing businesses observed in the current search task',
    );
  });

  it('does not rewrite a failed parent job run back to RUNNING during later slot progress updates', async () => {
    const jobRunId = randomUUID();

    dbMock.prisma.jobRun.updateMany.mockResolvedValue({ count: 0 });

    await handleDiscoveryRunSearchTaskJob(
      logger,
      makeJob({
        jobRunId,
      }),
      {
        boss: { send: vi.fn() },
        provider: {} as never,
        config: {} as never,
      },
    );

    expect(dbMock.prisma.jobRun.update).not.toHaveBeenCalled();
    expect(dbMock.prisma.jobRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: jobRunId,
        status: 'RUNNING',
        finishedAt: null,
      },
      data: expect.objectContaining({
        status: 'RUNNING',
        countersJson: expect.objectContaining({
          tasks_processed: 1,
          done: 1,
          failed: 0,
          skipped: 0,
        }),
      }),
    });
  });

  it('does not rewrite a failed parent job run back to SUCCESS after a later bounded slot completes', async () => {
    const jobRunId = randomUUID();

    dbMock.prisma.jobRun.updateMany.mockResolvedValue({ count: 0 });

    await handleDiscoveryRunSearchTaskJob(
      logger,
      makeJob({
        jobRunId,
        maxTasks: 1,
      }),
      {
        boss: { send: vi.fn() },
        provider: {} as never,
        config: {} as never,
      },
    );

    expect(dbMock.prisma.jobRun.update).not.toHaveBeenCalled();
    expect(dbMock.prisma.jobRun.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        where: {
          id: jobRunId,
          status: 'RUNNING',
          finishedAt: null,
        },
        data: expect.objectContaining({
          status: 'RUNNING',
        }),
      },
    );
    expect(dbMock.prisma.jobRun.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: jobRunId,
          status: 'RUNNING',
          finishedAt: null,
        },
        data: expect.objectContaining({
          status: 'SUCCESS',
          finishedAt: expect.any(Date),
          durationMs: expect.any(Number),
          errorText: null,
        }),
      },
    );
  });

  it('still finalizes a bounded parent job run successfully when it is still mutable', async () => {
    const jobRunId = randomUUID();

    dbMock.prisma.jobRun.updateMany.mockResolvedValue({ count: 1 });

    await handleDiscoveryRunSearchTaskJob(
      logger,
      makeJob({
        jobRunId,
        maxTasks: 1,
      }),
      {
        boss: { send: vi.fn() },
        provider: {} as never,
        config: {} as never,
      },
    );

    expect(dbMock.prisma.jobRun.update).not.toHaveBeenCalled();
    expect(dbMock.prisma.jobRun.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          id: jobRunId,
          status: 'RUNNING',
          finishedAt: null,
        },
        data: expect.objectContaining({
          status: 'SUCCESS',
          finishedAt: expect.any(Date),
          durationMs: expect.any(Number),
          errorText: null,
        }),
      },
    );
  });
});
