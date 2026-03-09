import { describe, expect, it } from 'vitest';

import { readRunProgress } from './discovery.repository.js';

describe('readRunProgress', () => {
  it('normalizes historical discovery results where failedItems included disqualifications', () => {
    expect(
      readRunProgress({
        totalItems: 49,
        processedItems: 33,
        failedItems: 23,
        newFound: 33,
        disqualified: 23,
      }),
    ).toEqual({
      totalItems: 33,
      processedItems: 33,
      failedItems: 0,
    });
  });

  it('preserves explicit lead failure counts for newer runs', () => {
    expect(
      readRunProgress({
        totalItems: 33,
        processedItems: 33,
        failedItems: 2,
        leadFailedItems: 2,
        newFound: 33,
        disqualified: 8,
      }),
    ).toEqual({
      totalItems: 33,
      processedItems: 33,
      failedItems: 2,
    });
  });
});
