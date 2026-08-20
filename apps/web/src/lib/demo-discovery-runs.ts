import type { DiscoveryRunSummary } from '@lead-flood/contracts';

import type { LeadFlowSankeyData } from '../components/lead-flow-sankey.js';

export interface DemoDiscoveryTaskPerformance {
  id: string;
  queryText: string;
  countryCode: string;
  city: string | null;
  status: string;
  provider: string;
  resultsCount: number | null;
  scoredCount: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface DemoDiscoveryRunPerformance {
  run: DiscoveryRunSummary;
  icpName: string | null;
  provider: string;
  taskBudget: number;
  tasksExecuted: number;
  resultsInspected: number;
  scoredResults: number;
  alreadyKnown: number;
  newBusinesses: number;
  leadsCreated: number;
  websitesScraped: number;
  pipelineMode: 'production_worker' | 'edge_legacy' | 'bundled_snapshot';
  scoringSources: {
    openAi: number;
    trainedModel: number;
    deterministicFallback: number;
  };
  durationMs: number | null;
  stopReason: string;
  tasks: DemoDiscoveryTaskPerformance[];
}

export const DEMO_DISCOVERY_ICP_ITEMS = [
  {
    id: 'demo-icp-dental-groups',
    name: 'Multi-Location Dental Groups',
    searchCategory: 'Dental Group',
  },
  {
    id: 'demo-icp-hospitality-operators',
    name: 'Boutique Hotels & Vacation Rentals',
    searchCategory: 'Boutique Hotel',
  },
  {
    id: 'demo-icp-commercial-contractors',
    name: 'Commercial Solar & Roofing Contractors',
    searchCategory: 'Commercial Solar Contractor',
  },
  {
    id: 'demo-icp-developer-platforms',
    name: 'B2B SaaS & Developer Platforms',
    searchCategory: 'Developer Tools Company',
  },
] as const;

const DEMO_DISCOVERY_CITIES = [
  'New York',
  'Los Angeles',
  'Chicago',
  'Houston',
  'Phoenix',
] as const;

const BASE_RUN_TIME_MS = Date.UTC(2026, 7, 11, 18, 40, 0);
const RUN_SPACING_MS = 33 * 60 * 60 * 1_000;
export const DEMO_DISCOVERY_RUNS: DiscoveryRunSummary[] = Array.from(
  { length: 48 },
  (_, index) => {
    const icp = DEMO_DISCOVERY_ICP_ITEMS[index % DEMO_DISCOVERY_ICP_ITEMS.length]!;
    const countries = ['US'];
    const createdAtMs = BASE_RUN_TIME_MS - index * RUN_SPACING_MS - (index % 4) * 13 * 60_000;
    const startedAtMs = createdAtMs + 1_000;
    const durationSeconds = 214 + (index * 37) % 287;
    const totalItems = 34 + (index * 11) % 17;
    const converted = 9 + (index * 5) % 18;

    return {
      runId: `demo-discovery-run-${String(index + 1).padStart(2, '0')}`,
      status: 'SUCCEEDED',
      totalItems,
      processedItems: totalItems,
      failedItems: 0,
      createdAt: new Date(createdAtMs).toISOString(),
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(startedAtMs + durationSeconds * 1_000).toISOString(),
      icpProfileId: icp.id,
      icpProfileIds: [icp.id],
      countries,
      limit: 5,
      converted,
      errorMessage: null,
      currentStage: 'completed',
    };
  },
);

const DEMO_DISCOVERY_RUN_PERFORMANCE = new Map<string, DemoDiscoveryRunPerformance>(
  DEMO_DISCOVERY_RUNS.map((run, runIndex) => {
    const icp = DEMO_DISCOVERY_ICP_ITEMS.find((item) => item.id === run.icpProfileId)!;
    const runStartedAtMs = new Date(run.startedAt ?? run.createdAt).getTime();
    const runFinishedAtMs = new Date(run.finishedAt ?? run.createdAt).getTime();
    const runDurationMs = Math.max(1_000, runFinishedAtMs - runStartedAtMs);
    const taskDurationMs = Math.max(1_000, Math.floor(runDurationMs / run.limit));
    const baseResults = Math.floor(run.totalItems / run.limit);
    const resultRemainder = run.totalItems % run.limit;
    const tasks = Array.from({ length: run.limit }, (_, taskIndex) => {
      const countryCode = 'US';
      const city = DEMO_DISCOVERY_CITIES[taskIndex % DEMO_DISCOVERY_CITIES.length] ?? null;
      const startedAtMs = runStartedAtMs + taskIndex * taskDurationMs;
      const finishedAtMs = taskIndex === run.limit - 1
        ? runFinishedAtMs
        : Math.min(runFinishedAtMs, startedAtMs + taskDurationMs);

      const resultsCount = baseResults + (taskIndex < resultRemainder ? 1 : 0);
      return {
        id: `${run.runId}-task-${taskIndex + 1}`,
        queryText: `${icp.searchCategory} ${city ?? countryCode}`,
        countryCode,
        city,
        status: 'DONE',
        provider: 'SerpAPI · Google Maps',
        resultsCount,
        scoredCount: resultsCount,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: Math.max(1_000, finishedAtMs - startedAtMs),
      } satisfies DemoDiscoveryTaskPerformance;
    });

    const alreadyKnown = 3 + (runIndex * 3) % 9;
    return [run.runId, {
      run,
      icpName: icp.name,
      provider: 'SerpAPI · Google Maps',
      taskBudget: run.limit,
      tasksExecuted: tasks.length,
      resultsInspected: run.totalItems,
      scoredResults: run.totalItems,
      alreadyKnown,
      newBusinesses: Math.max(0, run.totalItems - alreadyKnown),
      leadsCreated: run.converted ?? 0,
      websitesScraped: Math.max(0, run.totalItems - alreadyKnown),
      pipelineMode: 'bundled_snapshot',
      scoringSources: {
        openAi: run.totalItems,
        trainedModel: 0,
        deterministicFallback: 0,
      },
      durationMs: runDurationMs,
      stopReason: 'All five provider search tasks completed successfully.',
      tasks,
    } satisfies DemoDiscoveryRunPerformance] as const;
  }),
);

export function getDemoDiscoveryRunPerformance(
  runId: string,
): DemoDiscoveryRunPerformance | null {
  return DEMO_DISCOVERY_RUN_PERFORMANCE.get(runId) ?? null;
}

export function buildDemoDiscoveryLeadFlow(
  performance: DemoDiscoveryRunPerformance,
): LeadFlowSankeyData {
  const totalBusinesses = Math.max(0, performance.resultsInspected);
  const duplicates = Math.min(totalBusinesses, Math.max(0, performance.alreadyKnown));
  const evaluated = Math.min(
    Math.max(0, totalBusinesses - duplicates),
    Math.max(0, performance.newBusinesses),
  );
  const leadsCreated = Math.min(evaluated, Math.max(0, performance.leadsCreated));

  return {
    totalBusinesses,
    evaluated,
    outsideFlow: 0,
    duplicates,
    qualified: leadsCreated,
    notQualified: 0,
    high: leadsCreated,
    medium: 0,
    low: Math.max(0, evaluated - leadsCreated),
    unbanded: 0,
    sourceLabel: 'Results inspected',
    screenedLabel: 'New businesses',
    duplicateLabel: 'Already known',
    disqualifiedLabel: 'Disqualified',
    highLabel: 'Leads created',
    lowLabel: 'Not converted',
  };
}
