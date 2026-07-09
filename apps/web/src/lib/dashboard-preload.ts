import type { ApiClient } from './api-client.js';

const DASHBOARD_PRELOAD_TTL_MS = 30_000;

type DashboardCacheEntry<T> = {
  createdAt: number;
  promise: Promise<T>;
};

const dashboardPreloadCache = new Map<string, DashboardCacheEntry<unknown>>();

function serializeQuery(query?: object): string {
  const entries = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return 'default';
  }

  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

function dashboardQueryKey(name: string, query?: object): string {
  return `${name}:${serializeQuery(query)}`;
}

export const dashboardQueryKeys = {
  avgScore: (query?: object) => dashboardQueryKey('avg-score', query),
  discoveryRuns: (query?: object) => dashboardQueryKey('discovery-runs', query),
  drafts: (query?: object) => dashboardQueryKey('drafts', query),
  feedback: (query?: object) => dashboardQueryKey('feedback', query),
  funnel: (query?: object) => dashboardQueryKey('funnel', query),
  icpPerformance: (query?: object) => dashboardQueryKey('icp-performance', query),
  icps: (query?: object) => dashboardQueryKey('icps', query),
  qualityTrends: (query?: object) => dashboardQueryKey('quality-trends', query),
  scoreDistribution: (query?: object) => dashboardQueryKey('score-distribution', query),
} as const;

export function clearDashboardPreloadCache(): void {
  dashboardPreloadCache.clear();
}

export function getCachedDashboardQuery<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = dashboardPreloadCache.get(key) as DashboardCacheEntry<T> | undefined;

  if (cached && now - cached.createdAt < DASHBOARD_PRELOAD_TTL_MS) {
    return cached.promise;
  }

  if (cached) {
    dashboardPreloadCache.delete(key);
  }

  const promise = fetcher().catch((error: unknown) => {
    const current = dashboardPreloadCache.get(key);
    if (current?.promise === promise) {
      dashboardPreloadCache.delete(key);
    }
    throw error;
  });

  dashboardPreloadCache.set(key, { createdAt: now, promise });
  return promise;
}

export function warmDashboardData(apiClient: ApiClient): void {
  const analyticsFilter = {};
  const dateFilter = {};
  const icpsQuery = { page: 1, pageSize: 50 };
  const discoveryRunsQuery = { page: 1, pageSize: 6 };
  const draftsQuery = { approvalStatus: 'PENDING', page: 1, pageSize: 1 } as const;

  void Promise.allSettled([
    getCachedDashboardQuery(dashboardQueryKeys.icps(icpsQuery), () => apiClient.listIcps(icpsQuery)),
    getCachedDashboardQuery(dashboardQueryKeys.funnel(analyticsFilter), () => apiClient.getFunnel(analyticsFilter)),
    getCachedDashboardQuery(dashboardQueryKeys.scoreDistribution(analyticsFilter), () =>
      apiClient.getScoreDistribution(analyticsFilter),
    ),
    getCachedDashboardQuery(dashboardQueryKeys.feedback(analyticsFilter), () =>
      apiClient.getFeedbackSummary(analyticsFilter),
    ),
    getCachedDashboardQuery(dashboardQueryKeys.qualityTrends(dateFilter), () =>
      apiClient.getDailyQualityTrends(dateFilter),
    ),
    getCachedDashboardQuery(dashboardQueryKeys.icpPerformance(analyticsFilter), () =>
      apiClient.getIcpPerformance(analyticsFilter),
    ),
    getCachedDashboardQuery(dashboardQueryKeys.avgScore(analyticsFilter), () => apiClient.getAvgScore(analyticsFilter)),
    getCachedDashboardQuery(dashboardQueryKeys.discoveryRuns(discoveryRunsQuery), () =>
      apiClient.listDiscoveryRuns(discoveryRunsQuery),
    ),
    getCachedDashboardQuery(dashboardQueryKeys.drafts(draftsQuery), () => apiClient.listDrafts(draftsQuery)),
  ]);
}
