import { z } from 'zod';

export const ManagerRecommendationTypeSchema = z.enum([
  'ADJUST_WEIGHT',
  'ADJUST_THRESHOLD',
  'PAUSE_ICP',
  'INCREASE_VOLUME',
  'PREFER_VARIANT',
]);
export type ManagerRecommendationType = z.infer<typeof ManagerRecommendationTypeSchema>;

export const ManagerRecommendationSchema = z
  .object({
    type: ManagerRecommendationTypeSchema,
    icpProfileId: z.string().nullable(),
    field: z.string().nullable(),
    currentValue: z.number().nullable(),
    recommendedValue: z.number().nullable(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  })
  .strict();
export type ManagerRecommendation = z.infer<typeof ManagerRecommendationSchema>;

export const IcpBreakdownItemSchema = z
  .object({
    icpProfileId: z.string(),
    icpName: z.string(),
    sends: z.number().int().min(0),
    replies: z.number().int().min(0),
    positiveOutcomes: z.number().int().min(0),
    bounced: z.number().int().min(0),
    replyRate: z.number(),
    positiveRate: z.number(),
    bounceRate: z.number(),
  })
  .strict();
export type IcpBreakdownItem = z.infer<typeof IcpBreakdownItemSchema>;

export const VariantBreakdownItemSchema = z
  .object({
    variantKey: z.string(),
    channel: z.string(),
    sends: z.number().int().min(0),
    replies: z.number().int().min(0),
    replyRate: z.number(),
  })
  .strict();
export type VariantBreakdownItem = z.infer<typeof VariantBreakdownItemSchema>;

export const AbInsightPerIcpItemSchema = z
  .object({
    icpProfileId: z.string(),
    icpName: z.string(),
    variantKey: z.string(),
    sends: z.number().int().min(0),
    replies: z.number().int().min(0),
    replyRate: z.number(),
    positiveOutcomes: z.number().int().min(0),
    positiveRate: z.number(),
  })
  .strict();
export type AbInsightPerIcpItem = z.infer<typeof AbInsightPerIcpItemSchema>;

export const ScoreBandBreakdownItemSchema = z
  .object({
    scoreBand: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    sends: z.number().int().min(0),
    replies: z.number().int().min(0),
    replyRate: z.number(),
    positiveOutcomes: z.number().int().min(0),
    positiveRate: z.number(),
  })
  .strict();
export type ScoreBandBreakdownItem = z.infer<typeof ScoreBandBreakdownItemSchema>;

export const WeekTrendSchema = z
  .object({
    replyRate: z.number(),
    positiveRate: z.number(),
    bounceRate: z.number(),
    sends: z.number().int().min(0),
  })
  .strict();
export type WeekTrend = z.infer<typeof WeekTrendSchema>;

export const TrendComparisonSchema = z
  .object({
    currentWeek: WeekTrendSchema,
    previousWeek: WeekTrendSchema,
    replyRateDelta: z.number(),
    positiveRateDelta: z.number(),
    bounceRateDelta: z.number(),
  })
  .strict();
export type TrendComparison = z.infer<typeof TrendComparisonSchema>;

export const ManagerAnalysisResponseSchema = z
  .object({
    id: z.string(),
    runId: z.string(),
    weekStart: z.string().datetime(),
    weekEnd: z.string().datetime(),
    totalSends: z.number().int().min(0),
    totalReplies: z.number().int().min(0),
    totalPositive: z.number().int().min(0),
    totalBounced: z.number().int().min(0),
    overallReplyRate: z.number(),
    overallPositiveRate: z.number(),
    overallBounceRate: z.number(),
    icpBreakdown: z.array(IcpBreakdownItemSchema),
    variantBreakdown: z.array(VariantBreakdownItemSchema),
    abInsightsPerIcp: z.array(AbInsightPerIcpItemSchema).optional(),
    scoreBandBreakdown: z.array(ScoreBandBreakdownItemSchema),
    trend: TrendComparisonSchema,
    recommendations: z.array(ManagerRecommendationSchema),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ManagerAnalysisResponse = z.infer<typeof ManagerAnalysisResponseSchema>;

export const ManagerRecommendationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
export type ManagerRecommendationsQuery = z.infer<typeof ManagerRecommendationsQuerySchema>;

export const ManagerRecommendationsResponseSchema = z
  .object({
    items: z.array(ManagerAnalysisResponseSchema),
  })
  .strict();
export type ManagerRecommendationsResponse = z.infer<typeof ManagerRecommendationsResponseSchema>;
