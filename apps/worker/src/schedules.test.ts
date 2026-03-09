import { describe, expect, it, vi } from 'vitest';

import { registerWorkerSchedules } from './schedules.js';

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
});
