import { describe, expect, it } from 'vitest';

import {
  DEMO_DISCOVERY_ICP_ITEMS,
  DEMO_DISCOVERY_RUNS,
  buildDemoDiscoveryLeadFlow,
  getDemoDiscoveryRunPerformance,
} from './demo-discovery-runs.js';

describe('demo discovery run history', () => {
  it('uses four distinct ICP markets across the United States', () => {
    expect(DEMO_DISCOVERY_ICP_ITEMS).toHaveLength(4);
    expect(new Set(DEMO_DISCOVERY_ICP_ITEMS.map((icp) => icp.name)).size).toBe(4);
    expect(new Set(DEMO_DISCOVERY_ICP_ITEMS.map((icp) => icp.searchCategory)).size).toBe(4);
    expect(DEMO_DISCOVERY_RUNS.every((run) => run.countries.length === 1 && run.countries[0] === 'US')).toBe(true);
  });

  it('provides dozens of deterministic, successful five-task runs', () => {
    expect(DEMO_DISCOVERY_RUNS).toHaveLength(48);
    expect(new Set(DEMO_DISCOVERY_RUNS.map((run) => run.runId)).size).toBe(48);
    expect(DEMO_DISCOVERY_RUNS.every((run) => run.status === 'SUCCEEDED')).toBe(true);
    expect(DEMO_DISCOVERY_RUNS.every((run) => run.limit === 5)).toBe(true);
    expect(DEMO_DISCOVERY_RUNS.every((run) => run.processedItems === run.totalItems)).toBe(true);
  });

  it('maps every run to a named demo ICP', () => {
    const icpIds = new Set<string>(DEMO_DISCOVERY_ICP_ITEMS.map((icp) => icp.id));

    expect(DEMO_DISCOVERY_RUNS.every((run) => run.icpProfileId && icpIds.has(run.icpProfileId))).toBe(true);
  });

  it('provides a five-task performance drill-down for every bundled run', () => {
    for (const run of DEMO_DISCOVERY_RUNS) {
      const performance = getDemoDiscoveryRunPerformance(run.runId);

      expect(performance?.tasks).toHaveLength(5);
      expect(new Set(performance?.tasks.map((task) => task.city))).toEqual(
        new Set(['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix']),
      );
      expect(performance?.tasks.reduce((sum, task) => sum + (task.resultsCount ?? 0), 0)).toBe(run.totalItems);
      expect(performance?.tasks.reduce((sum, task) => sum + task.scoredCount, 0)).toBe(run.totalItems);
      expect(performance?.scoredResults).toBe(run.totalItems);
      expect(performance?.durationMs).toBeGreaterThanOrEqual(3 * 60 * 1_000);
    }
  });

  it('builds a balanced Sankey flow from run performance totals', () => {
    const performance = getDemoDiscoveryRunPerformance(DEMO_DISCOVERY_RUNS[0]!.runId)!;
    const flow = buildDemoDiscoveryLeadFlow(performance);

    expect(flow.evaluated + (flow.duplicates ?? 0)).toBe(flow.totalBusinesses);
    expect(flow.high + flow.medium + flow.low + flow.notQualified).toBe(flow.evaluated);
    expect(flow.highLabel).toBe('Leads created');
    expect(flow.lowLabel).toBe('Not converted');
  });
});
