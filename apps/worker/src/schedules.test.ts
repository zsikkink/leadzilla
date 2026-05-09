import { describe, expect, it, vi } from 'vitest';

import { registerWorkerHeartbeatSchedule, registerWorkerSchedules } from './schedules.js';

describe('registerWorkerHeartbeatSchedule', () => {
  it('registers only the worker heartbeat schedule', async () => {
    const schedule = vi.fn(async () => null);

    await registerWorkerHeartbeatSchedule({ schedule } as never);

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith(
      'system.heartbeat',
      '*/1 * * * *',
      { source: 'scheduler' },
      expect.objectContaining({
        singletonKey: 'system.heartbeat',
      }),
    );
  });
});

describe('registerWorkerSchedules', () => {
  it('skips discovery.seed schedule when discovery schedule kill switch is disabled', async () => {
    const schedule = vi.fn(async () => null);
    const logger = { info: vi.fn() };

    await registerWorkerSchedules({ schedule } as never, {
      discoveryScheduleEnabled: false,
      logger,
    });

    const calls = schedule.mock.calls as unknown[][];
    const discoverySeedSchedules = calls.filter(
      (call) => call[0] === 'discovery.seed',
    );
    expect(discoverySeedSchedules).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      { discoveryScheduleEnabled: false },
      'Discovery schedule disabled by configuration',
    );
  });

  it('registers discovery.seed schedule when discovery schedule is enabled', async () => {
    const schedule = vi.fn(async () => null);

    await registerWorkerSchedules({ schedule } as never, {
      discoveryScheduleEnabled: true,
    });

    const calls = schedule.mock.calls as unknown[][];
    const discoverySeedSchedules = calls.filter(
      (call) => call[0] === 'discovery.seed',
    );
    expect(discoverySeedSchedules).toHaveLength(1);
  });

  it('registers scheduled retraining through the schedule wrapper queue without a static trainingRunId', async () => {
    const schedule = vi.fn(async () => null);

    await registerWorkerSchedules({ schedule } as never, {
      discoveryScheduleEnabled: true,
    });

    const scheduledRetrainCall = (schedule.mock.calls as unknown[][]).find(
      (call) => call[0] === 'model.train.schedule',
    );

    expect(scheduledRetrainCall).toBeDefined();
    expect(scheduledRetrainCall?.[1]).toBe('0 3 * * 1');
    expect(scheduledRetrainCall?.[2]).toEqual({
      trigger: 'SCHEDULED',
      windowDays: 90,
      minSamples: 100,
      activateIfPass: true,
      correlationId: 'scheduler:model.train',
    });
    expect(scheduledRetrainCall?.[2]).not.toHaveProperty('trainingRunId');
    expect(scheduledRetrainCall?.[3]).toEqual(
      expect.objectContaining({
        singletonKey: 'schedule:model.train',
      }),
    );
  });
});
