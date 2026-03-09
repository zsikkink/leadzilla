import { describe, expect, it } from 'vitest';

import { WORKER_QUEUE_DEFINITIONS } from './queues.js';

describe('WORKER_QUEUE_DEFINITIONS', () => {
  it('includes every scheduled recovery queue', () => {
    expect(WORKER_QUEUE_DEFINITIONS.some((queue) => queue.name === 'search-task.recovery')).toBe(
      true,
    );
  });
});
