import { z } from 'zod';

export const AnalyticsScoreBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const FunnelQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    icpProfileId: z.string().min(1).optional(),
  })
  .strict();

export const FunnelResponseSchema = z
  .object({
    from: z.string().datetime().nullable(),
    to: z.string().datetime().nullable(),
    icpProfileId: z.string().nullable(),
    discoveredCount: z.number().int().min(0),
    qualifiedCount: z.number().int().min(0),
    enrichedCount: z.number().int().min(0),
    scoredCount: z.number().int().min(0),
    messagesGeneratedCount: z.number().int().min(0),
    messagesSentCount: z.number().int().min(0),
    repliesCount: z.number().int().min(0),
    meetingsCount: z.number().int().min(0),
    dealsWonCount: z.number().int().min(0),
    totalCostCents: z.number().int().min(0),
    costPerLead: z.number().min(0),
  })
  .strict();

export const ScoreDistributionQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    icpProfileId: z.string().min(1).optional(),
    modelVersionId: z.string().min(1).optional(),
  })
  .strict();

export const ScoreDistributionResponseSchema = z
  .object({
    bands: z.array(
      z
        .object({
          scoreBand: AnalyticsScoreBandSchema,
          count: z.number().int().min(0),
        })
        .strict(),
    ),
  })
  .strict();

export const DailyQualityTrendsQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const DailyQualityTrendItemSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    avgScore: z.number().min(0).max(1),
    totalCreated: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
  })
  .strict();

export const DailyQualityTrendsResponseSchema = z
  .object({
    items: z.array(DailyQualityTrendItemSchema),
  })
  .strict();

export const AvgScoreQuerySchema = z.object({}).strict();

export const AvgScoreResponseSchema = z
  .object({
    avgScore: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const IcpPerformanceQuerySchema = z.object({}).strict();

export const IcpPerformanceItemSchema = z
  .object({
    icpProfileId: z.string().min(1),
    leadCount: z.number().int().min(0),
    avgScore: z.number().min(0).max(1).nullable(),
    qualifiedCount: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
  })
  .strict();

export const IcpPerformanceResponseSchema = z
  .object({
    items: z.array(IcpPerformanceItemSchema),
  })
  .strict();

export const ModelMetricsQuerySchema = z
  .object({
    modelVersionId: z.string().min(1).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const ModelMetricsResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          modelVersionId: z.string(),
          versionTag: z.string(),
          split: z.enum(['TRAIN', 'VALIDATION', 'TEST']),
          evaluatedAt: z.string().datetime(),
          auc: z.number(),
          prAuc: z.number(),
          precision: z.number(),
          recall: z.number(),
          f1: z.number(),
          brierScore: z.number(),
        })
        .strict(),
    ),
  })
  .strict();

export const RetrainStatusQuerySchema = z
  .object({
    modelType: z.enum(['LOGISTIC_REGRESSION']).optional(),
  })
  .strict();

export const RetrainStatusResponseSchema = z
  .object({
    activeModelVersionId: z.string().nullable(),
    currentRun: z
      .object({
        trainingRunId: z.string(),
        status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']),
        startedAt: z.string().datetime().nullable(),
        endedAt: z.string().datetime().nullable(),
      })
      .nullable(),
    lastSuccessfulRun: z
      .object({
        trainingRunId: z.string(),
        endedAt: z.string().datetime(),
      })
      .nullable(),
    nextScheduledAt: z.string().datetime().nullable(),
  })
  .strict();

export const RecomputeRollupRequestSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    icpProfileId: z.string().min(1).optional(),
    fullRecompute: z.boolean().default(false),
    requestedByUserId: z.string().min(1).optional(),
  })
  .strict();

export type FunnelQuery = z.infer<typeof FunnelQuerySchema>;
export type FunnelResponse = z.infer<typeof FunnelResponseSchema>;
export type ScoreDistributionQuery = z.infer<typeof ScoreDistributionQuerySchema>;
export type ScoreDistributionResponse = z.infer<typeof ScoreDistributionResponseSchema>;
export type DailyQualityTrendsQuery = z.infer<typeof DailyQualityTrendsQuerySchema>;
export type DailyQualityTrendItem = z.infer<typeof DailyQualityTrendItemSchema>;
export type DailyQualityTrendsResponse = z.infer<typeof DailyQualityTrendsResponseSchema>;
export type AvgScoreQuery = z.infer<typeof AvgScoreQuerySchema>;
export type AvgScoreResponse = z.infer<typeof AvgScoreResponseSchema>;
export type IcpPerformanceQuery = z.infer<typeof IcpPerformanceQuerySchema>;
export type IcpPerformanceItem = z.infer<typeof IcpPerformanceItemSchema>;
export type IcpPerformanceResponse = z.infer<typeof IcpPerformanceResponseSchema>;
export type ModelMetricsQuery = z.infer<typeof ModelMetricsQuerySchema>;
export type ModelMetricsResponse = z.infer<typeof ModelMetricsResponseSchema>;
export type RetrainStatusQuery = z.infer<typeof RetrainStatusQuerySchema>;
export type RetrainStatusResponse = z.infer<typeof RetrainStatusResponseSchema>;
export type RecomputeRollupRequest = z.infer<typeof RecomputeRollupRequestSchema>;
