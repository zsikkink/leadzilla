import { describe, expect, it } from 'vitest';

import { shouldFinalizeAfterEmptyPoll } from './discovery.run_search_task.job.js';

describe('shouldFinalizeAfterEmptyPoll', () => {
  it('does not finalize when sibling slots are still active', () => {
    expect(shouldFinalizeAfterEmptyPoll({ activeSlots: 2 })).toBe(false);
  });

  it('finalizes when this is the last active slot', () => {
    expect(shouldFinalizeAfterEmptyPoll({ activeSlots: 1 })).toBe(true);
  });
});
