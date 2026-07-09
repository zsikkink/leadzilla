import type {
  AvgScoreQuery,
  AvgScoreResponse,
  DailyQualityTrendsQuery,
  DailyQualityTrendsResponse,
  DashboardSummaryQuery,
  DashboardSummaryResponse,
  FunnelQuery,
  FunnelResponse,
  IcpPerformanceQuery,
  IcpPerformanceResponse,
  ManagerRecommendationsQuery,
  ManagerRecommendationsResponse,
  ModelMetricsQuery,
  ModelMetricsResponse,
  RecomputeRollupRequest,
  RetrainStatusQuery,
  RetrainStatusResponse,
  ScoreDistributionQuery,
  ScoreDistributionResponse,
  StoredRecommendation,
  StoredRecommendationsQuery,
  StoredRecommendationsResponse,
  UpdateRecommendationStatusRequest,
} from '@lead-flood/contracts';

import type { AnalyticsRepository } from './analytics.repository.js';

export interface AnalyticsRollupJobPayload {
  runId: string;
  day: string;
  icpProfileId?: string | undefined;
  fullRecompute?: boolean | undefined;
  requestedByUserId?: string | undefined;
  correlationId?: string | undefined;
}

export interface AnalyticsServiceDependencies {
  enqueueAnalyticsRollup?: ((payload: AnalyticsRollupJobPayload) => Promise<void>) | undefined;
}

export interface AnalyticsService {
  getFunnel(query: FunnelQuery): Promise<FunnelResponse>;
  getScoreDistribution(query: ScoreDistributionQuery): Promise<ScoreDistributionResponse>;
  getDailyQualityTrends(query: DailyQualityTrendsQuery): Promise<DailyQualityTrendsResponse>;
  getAvgScore(query: AvgScoreQuery): Promise<AvgScoreResponse>;
  getIcpPerformance(query: IcpPerformanceQuery): Promise<IcpPerformanceResponse>;
  getDashboardSummary(query: DashboardSummaryQuery): Promise<DashboardSummaryResponse>;
  getModelMetrics(query: ModelMetricsQuery): Promise<ModelMetricsResponse>;
  getRetrainStatus(query: RetrainStatusQuery): Promise<RetrainStatusResponse>;
  recomputeRollup(input: RecomputeRollupRequest): Promise<void>;
  getManagerRecommendations(query: ManagerRecommendationsQuery): Promise<ManagerRecommendationsResponse>;
  getStoredRecommendations(query: StoredRecommendationsQuery): Promise<StoredRecommendationsResponse>;
  updateRecommendationStatus(id: string, input: UpdateRecommendationStatusRequest): Promise<StoredRecommendation>;
}

export function buildAnalyticsService(
  repository: AnalyticsRepository,
  dependencies?: AnalyticsServiceDependencies,
): AnalyticsService {
  return {
    async getFunnel(query) {
      return repository.getFunnel(query);
    },
    async getScoreDistribution(query) {
      return repository.getScoreDistribution(query);
    },
    async getDailyQualityTrends(query) {
      return repository.getDailyQualityTrends(query);
    },
    async getAvgScore(query) {
      return repository.getAvgScore(query);
    },
    async getIcpPerformance(query) {
      return repository.getIcpPerformance(query);
    },
    async getDashboardSummary(query) {
      return repository.getDashboardSummary(query);
    },
    async getModelMetrics(query) {
      return repository.getModelMetrics(query);
    },
    async getRetrainStatus(query) {
      return repository.getRetrainStatus(query);
    },
    async recomputeRollup(input) {
      if (dependencies?.enqueueAnalyticsRollup) {
        const runId = `rollup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await dependencies.enqueueAnalyticsRollup({
          runId,
          day: input.day,
          icpProfileId: input.icpProfileId,
          fullRecompute: input.fullRecompute,
          requestedByUserId: input.requestedByUserId ?? undefined,
        });
        return;
      }
      await repository.recomputeRollup(input);
    },
    async getManagerRecommendations(query) {
      return repository.getManagerRecommendations(query);
    },
    async getStoredRecommendations(query) {
      return repository.getStoredRecommendations(query);
    },
    async updateRecommendationStatus(id, input) {
      return repository.updateRecommendationStatus(id, input);
    },
  };
}
