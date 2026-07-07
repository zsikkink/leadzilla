import { describe, expect, it } from 'vitest';

import {
  MESSAGED_LEAD_STATUSES,
  QUALIFIED_LEAD_STATUSES,
  sumAllLeadStatusCounts,
  sumLeadStatusCounts,
} from './metrics.contract.js';

describe('metric status helpers', () => {
  const rows = [
    { status: 'new', count: 12 },
    { status: 'qualified', count: 4 },
    { status: 'drafted', count: 3 },
    { status: 'messaged', count: 2 },
    { status: 'replied', count: 1 },
    { status: 'rejected', count: 9 },
  ];

  it('sums reached-stage qualified statuses consistently', () => {
    expect(sumLeadStatusCounts(rows, QUALIFIED_LEAD_STATUSES)).toBe(10);
  });

  it('sums reached-stage messaged statuses consistently', () => {
    expect(sumLeadStatusCounts(rows, MESSAGED_LEAD_STATUSES)).toBe(3);
  });

  it('sums all status rows for uncapped discovered totals', () => {
    expect(sumAllLeadStatusCounts(rows)).toBe(31);
  });
});
