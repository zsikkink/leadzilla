import { describe, expect, it } from 'vitest';

import { filterPrecomputedBuckets, type PipelineTrendBucket } from './pipeline-time-series-chart.js';

const dailyBuckets: PipelineTrendBucket[] = Array.from({ length: 61 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 5, index + 1));
  return {
    date: date.toISOString().slice(0, 10),
    Activated: 0,
    Qualified: 0,
    Rejected: 0,
    Sent: 0,
    Replied: 0,
  };
});

describe('filterPrecomputedBuckets', () => {
  it('keeps a true calendar window and represents pre-campaign inactivity with zero-value days', () => {
    const oneWeek = filterPrecomputedBuckets(dailyBuckets, '7d');
    const oneMonth = filterPrecomputedBuckets(dailyBuckets, '1m');

    expect(oneWeek).toHaveLength(7);
    expect(oneWeek.at(0)?.date).toBe('2026-07-25');
    expect(oneMonth).toHaveLength(30);
    expect(oneMonth.at(0)?.date).toBe('2026-07-02');
    const threeMonths = filterPrecomputedBuckets(dailyBuckets, '3m');
    const sixMonths = filterPrecomputedBuckets(dailyBuckets, '6m');
    const allHistory = filterPrecomputedBuckets(dailyBuckets, 'all');

    expect(threeMonths).toHaveLength(92);
    expect(threeMonths.at(0)?.date).toBe('2026-05-01');
    expect(threeMonths.slice(0, 31).every((bucket) => bucket.Sent === 0 && bucket.Activated === 0)).toBe(true);
    expect(sixMonths).toHaveLength(183);
    expect(sixMonths.slice(0, 122).every((bucket) => bucket.Replied === 0 && bucket.Qualified === 0)).toBe(true);
    expect(allHistory).toHaveLength(365);
    expect(allHistory.at(0)?.date).toBe('2025-08-01');
    expect(allHistory.slice(0, 304).every((bucket) => bucket.Rejected === 0 && bucket.Sent === 0)).toBe(true);
  });
});
