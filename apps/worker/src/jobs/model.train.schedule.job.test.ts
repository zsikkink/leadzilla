import type { Job } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      trainingRun: {
        upsert: vi.fn(),
        update: vi.fn(),
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

import {
  handleModelTrainScheduleJob,
  type ModelTrainScheduleJobPayload,
} from './model.train.schedule.job.js';

function makeJob(data: ModelTrainScheduleJobPayload): Job<ModelTrainScheduleJobPayload> {
  return {
    id: 'schedule_job_1',
    name: 'model.train.schedule',
    data,
  } as Job<ModelTrainScheduleJobPayload>;
}

const logger = {
  info: vi.fn(),
  error: vi.fn(),
};

describe('handleModelTrainScheduleJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T03:00:00.000Z'));
    dbMock.prisma.trainingRun.upsert.mockResolvedValue({ id: 'scheduled:model.train:schedule_job_1' });
    dbMock.prisma.trainingRun.update.mockResolvedValue({ id: 'scheduled:model.train:schedule_job_1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the scheduled training run before enqueuing model.train', async () => {
    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleModelTrainScheduleJob(
      logger,
      makeJob({
        trigger: 'SCHEDULED',
        windowDays: 90,
        minSamples: 100,
        activateIfPass: true,
        correlationId: 'scheduler:model.train',
      }),
      { boss },
    );

    expect(dbMock.prisma.trainingRun.upsert).toHaveBeenCalledWith({
      where: { id: 'scheduled:model.train:schedule_job_1' },
      update: {
        status: 'QUEUED',
        endedAt: null,
        errorMessage: null,
      },
      create: expect.objectContaining({
        id: 'scheduled:model.train:schedule_job_1',
        modelType: 'LOGISTIC_REGRESSION',
        status: 'QUEUED',
        trigger: 'SCHEDULED',
        configJson: {
          windowDays: 90,
          minSamples: 100,
          activateIfPass: true,
        },
        trainingWindowStart: expect.any(Date),
        trainingWindowEnd: new Date('2026-03-29T03:00:00.000Z'),
      }),
    });
    expect(boss.send).toHaveBeenCalledWith(
      'model.train',
      {
        runId: 'scheduled:model.train:schedule_job_1',
        trainingRunId: 'scheduled:model.train:schedule_job_1',
        trigger: 'SCHEDULED',
        windowDays: 90,
        minSamples: 100,
        activateIfPass: true,
        correlationId: 'scheduler:model.train',
      },
      expect.objectContaining({
        singletonKey: 'model.train:scheduled:model.train:schedule_job_1',
      }),
    );

    const trainingRunCreateCall = dbMock.prisma.trainingRun.upsert.mock.calls[0]?.[0];
    expect(trainingRunCreateCall?.create.trainingWindowStart).toBeInstanceOf(Date);
    expect(trainingRunCreateCall?.create.trainingWindowStart.getTime()).toBeLessThan(
      trainingRunCreateCall?.create.trainingWindowEnd.getTime() ?? 0,
    );

    const trainingRunCreateOrder = dbMock.prisma.trainingRun.upsert.mock.invocationCallOrder[0];
    const modelTrainSendOrder = boss.send.mock.invocationCallOrder[0];
    expect(trainingRunCreateOrder).toBeDefined();
    expect(modelTrainSendOrder).toBeDefined();
    expect(trainingRunCreateOrder!).toBeLessThan(modelTrainSendOrder!);
    expect(dbMock.prisma.trainingRun.update).not.toHaveBeenCalled();
  });

  it('marks the scheduled training run failed when enqueueing model.train fails', async () => {
    const enqueueError = new Error('pg-boss unavailable');
    const boss = {
      send: vi.fn().mockRejectedValue(enqueueError),
    };

    await expect(
      handleModelTrainScheduleJob(
        logger,
        makeJob({
          trigger: 'SCHEDULED',
          windowDays: 90,
          minSamples: 100,
          activateIfPass: true,
          correlationId: 'scheduler:model.train',
        }),
        { boss },
      ),
    ).rejects.toBe(enqueueError);

    expect(dbMock.prisma.trainingRun.upsert).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.trainingRun.update).toHaveBeenCalledWith({
      where: { id: 'scheduled:model.train:schedule_job_1' },
      data: {
        status: 'FAILED',
        endedAt: expect.any(Date),
        errorMessage: 'Failed to enqueue model.train job: pg-boss unavailable',
      },
    });

    const trainingRunCreateOrder = dbMock.prisma.trainingRun.upsert.mock.invocationCallOrder[0];
    const enqueueOrder = boss.send.mock.invocationCallOrder[0];
    const trainingRunFailOrder = dbMock.prisma.trainingRun.update.mock.invocationCallOrder[0];
    expect(trainingRunCreateOrder).toBeDefined();
    expect(enqueueOrder).toBeDefined();
    expect(trainingRunFailOrder).toBeDefined();
    expect(trainingRunCreateOrder!).toBeLessThan(enqueueOrder!);
    expect(enqueueOrder!).toBeLessThan(trainingRunFailOrder!);
  });
});
