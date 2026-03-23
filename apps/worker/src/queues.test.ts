import { describe, expect, it, vi } from 'vitest';

import { MESSAGE_GENERATE_JOB_NAME } from './jobs/message.generate.job.js';
import { MESSAGE_SEND_JOB_NAME } from './jobs/message.send.job.js';
import { WORKER_QUEUE_DEFINITIONS, ensureWorkerQueues } from './queues.js';

describe('WORKER_QUEUE_DEFINITIONS', () => {
  it('includes every scheduled recovery queue', () => {
    expect(WORKER_QUEUE_DEFINITIONS.some((queue) => queue.name === 'search-task.recovery')).toBe(
      true,
    );
    expect(WORKER_QUEUE_DEFINITIONS.some((queue) => queue.name === 'message.approval.recovery')).toBe(
      true,
    );
  });

  it('configures message.send and message.generate with short queue policy', () => {
    expect(WORKER_QUEUE_DEFINITIONS).toContainEqual(
      expect.objectContaining({
        name: MESSAGE_SEND_JOB_NAME,
        policy: 'short',
      }),
    );
    expect(WORKER_QUEUE_DEFINITIONS).toContainEqual(
      expect.objectContaining({
        name: MESSAGE_GENERATE_JOB_NAME,
        policy: 'short',
      }),
    );
  });
});

describe('ensureWorkerQueues', () => {
  it('updates the existing message.send and message.generate queues to short policy during bootstrap', async () => {
    const createQueue = vi.fn().mockResolvedValue(undefined);
    const updateQueue = vi.fn().mockResolvedValue(undefined);

    await ensureWorkerQueues({ createQueue, updateQueue });

    expect(updateQueue).toHaveBeenCalledWith(
      MESSAGE_SEND_JOB_NAME,
      expect.objectContaining({ name: MESSAGE_SEND_JOB_NAME, policy: 'short' }),
    );
    expect(updateQueue).toHaveBeenCalledWith(
      MESSAGE_GENERATE_JOB_NAME,
      expect.objectContaining({ name: MESSAGE_GENERATE_JOB_NAME, policy: 'short' }),
    );
  });
});
