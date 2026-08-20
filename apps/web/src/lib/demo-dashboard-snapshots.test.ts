import { describe, expect, it } from 'vitest';

import {
  DEMO_ANALYTICS_DASHBOARD_SNAPSHOT,
  DEMO_OPERATIONS_DASHBOARD_SNAPSHOT,
} from './demo-dashboard-snapshots.js';
import { DEMO_OPERATING_TOTALS } from './demo-operating-narrative.js';

describe('bundled demo dashboard snapshots', () => {
  it('contains credible operations and analytics data', () => {
    expect(DEMO_OPERATIONS_DASHBOARD_SNAPSHOT.metrics.length).toBeGreaterThan(0);
    expect(DEMO_OPERATIONS_DASHBOARD_SNAPSHOT.recentRuns.length).toBeGreaterThan(0);
    expect(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.leadFlow.totalBusinesses).toBeGreaterThan(0);
    expect(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.icpPerformance.length).toBeGreaterThan(0);
  });

  it('uses four distinct ICP markets instead of four software variants', () => {
    expect(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.icpPerformance.map((icp) => icp.name)).toEqual([
      'Boutique Hotels & Vacation Rentals',
      'Commercial Solar & Roofing Contractors',
      'B2B SaaS & Developer Platforms',
      'Multi-Location Dental Groups',
    ]);
  });

  it('keeps outbound delivery explicitly disabled', () => {
    const outbound = DEMO_OPERATIONS_DASHBOARD_SNAPSHOT.systemHealth.find(
      (item) => item.id === 'outbound-delivery',
    );

    expect(outbound?.status).toBe('Disabled');
    expect(DEMO_OPERATIONS_DASHBOARD_SNAPSHOT.safety.status).toBe('Outbound delivery locked');
    expect(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.safety.detail).toContain(
      'Outbound delivery remains disabled',
    );
  });

  it('reconciles dashboard outcomes with the shared operating narrative', () => {
    expect(DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.leadFlow).toMatchObject({
      totalBusinesses: DEMO_OPERATING_TOTALS.screened,
      evaluated: DEMO_OPERATING_TOTALS.scored,
      qualified: DEMO_OPERATING_TOTALS.priority,
      notQualified: DEMO_OPERATING_TOTALS.disqualified,
      high: DEMO_OPERATING_TOTALS.highFit,
      medium: DEMO_OPERATING_TOTALS.mediumFit,
      low: DEMO_OPERATING_TOTALS.lowFit,
    });

    const outcomes = new Map(
      DEMO_ANALYTICS_DASHBOARD_SNAPSHOT.outcomeSummary.map((outcome) => [outcome.id, outcome.value]),
    );
    expect(outcomes.get('drafts')).toBe(DEMO_OPERATING_TOTALS.drafts.toLocaleString('en-US'));
    expect(outcomes.get('sent')).toBe(DEMO_OPERATING_TOTALS.sent.toLocaleString('en-US'));
    expect(outcomes.get('replies')).toBe(DEMO_OPERATING_TOTALS.replies.toLocaleString('en-US'));
    expect(outcomes.get('meetings')).toBe(DEMO_OPERATING_TOTALS.meetings.toLocaleString('en-US'));
    expect(outcomes.get('reply-rate')).toBe('13.9%');
  });
});
