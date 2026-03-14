import { describe, expect, it, vi } from 'vitest';

import { getPipelineStatsSnapshot } from './pipeline-stats.js';
import type { SqlQueryable } from './postgres.js';

function createQueryable(rows: unknown[]): SqlQueryable {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce({ rows: [rows[0]] })
      .mockResolvedValueOnce({ rows: [rows[1]] }),
  } as SqlQueryable;
}

describe('getPipelineStatsSnapshot', () => {
  it('maps aggregate rows into the pipeline stats shape', async () => {
    const db = createQueryable([
      {
        discovered: 2,
        enriched: 3,
        scored: 23,
        messaged: 49,
      },
      {
        pendingApprovals: 23,
      },
    ]);

    await expect(getPipelineStatsSnapshot(db)).resolves.toEqual({
      leadDistribution: {
        discovered: 2,
        enriched: 3,
        scored: 23,
        messaged: 49,
      },
      pendingApprovals: 23,
    });
  });

  it('normalizes string counts from SQL drivers', async () => {
    const db = createQueryable([
      {
        discovered: '1',
        enriched: '2',
        scored: '3',
        messaged: '4',
      },
      {
        pendingApprovals: '5',
      },
    ]);

    await expect(getPipelineStatsSnapshot(db)).resolves.toEqual({
      leadDistribution: {
        discovered: 1,
        enriched: 2,
        scored: 3,
        messaged: 4,
      },
      pendingApprovals: 5,
    });
  });
});
