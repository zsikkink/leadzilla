import { describe, expect, it } from 'vitest';

import { shouldStopPersistingBusinesses } from './run_search_task.js';

describe('shouldStopPersistingBusinesses', () => {
  it('keeps persisting when no budget is configured', () => {
    expect(shouldStopPersistingBusinesses(5, undefined)).toBe(false);
  });

  it('stops once the budget has been reached', () => {
    expect(shouldStopPersistingBusinesses(3, 3)).toBe(true);
    expect(shouldStopPersistingBusinesses(4, 3)).toBe(true);
  });

  it('allows inserts while still below budget', () => {
    expect(shouldStopPersistingBusinesses(2, 3)).toBe(false);
  });
});
