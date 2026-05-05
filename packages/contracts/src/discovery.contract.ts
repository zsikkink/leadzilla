import { z } from 'zod';
import {
  SupportedCountryCodeSchema,
  normalizeCountryCodeOrAlias,
  normalizeCountryCodes,
} from './country.contract.js';

/** All valid ISO 3166-1 alpha-2 country codes for discovery runs. */
export const DiscoveryCountryCodeSchema = SupportedCountryCodeSchema;

export type DiscoveryCountryCodeContract = z.infer<typeof DiscoveryCountryCodeSchema>;
export const DiscoveryCountryCodes = DiscoveryCountryCodeSchema.options;

const DISCOVERY_COUNTRY_CODE_SET = new Set<DiscoveryCountryCodeContract>(DiscoveryCountryCodes);

export function normalizeDiscoveryCountryCode(
  value: string | null | undefined,
): DiscoveryCountryCodeContract | null {
  if (!value) {
    return null;
  }

  const upper = value.trim().toUpperCase();
  if (DISCOVERY_COUNTRY_CODE_SET.has(upper as DiscoveryCountryCodeContract)) {
    return upper as DiscoveryCountryCodeContract;
  }

  return normalizeCountryCodeOrAlias(value);
}

export function normalizeDiscoveryCountryCodes(
  values: readonly (string | null | undefined)[],
): DiscoveryCountryCodeContract[] {
  return normalizeCountryCodes(values);
}

export const DiscoveryProviderSchema = z.enum([
  'BRAVE_SEARCH',
  'GOOGLE_PLACES',
  'LINKEDIN_SCRAPE',
  'COMPANY_SEARCH_FREE',
  'APOLLO',
  'SERPAPI',
]);

// Legacy read compatibility for historical records written before Google CSE retirement.
// Includes all current providers + deprecated GOOGLE_SEARCH for historical data.
export const DiscoveryRecordProviderSchema = z.union([
  DiscoveryProviderSchema,
  z.literal('GOOGLE_SEARCH'),
]);

export const DiscoveryRecordStatusSchema = z.enum(['DISCOVERED', 'DUPLICATE', 'REJECTED', 'ERROR']);

export const DiscoveryPipelineRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'PARTIAL',
  'CANCELLED',
]);

export const DiscoveryRunIdParamsSchema = z
  .object({
    runId: z.string().min(1),
  })
  .strict();

export const DiscoveryAdvancedSettingsSchema = z
  .object({
    minReviewCount: z.coerce.number().int().min(0).default(0),
    searchCategories: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CreateDiscoveryRunRequestSchema = z
  .object({
    /** @deprecated Use icpProfileIds instead */
    icpProfileId: z.string().min(1).optional(),
    /** Array of ICP profile IDs to discover for */
    icpProfileIds: z.array(z.string().min(1)).min(1).optional(),
    countries: z.preprocess((value) => {
      if (!Array.isArray(value)) return value;
      return value.map((entry) =>
        typeof entry === 'string' ? (normalizeDiscoveryCountryCode(entry) ?? entry) : entry,
      );
    }, z.array(SupportedCountryCodeSchema).min(1)),
    cities: z.array(z.string().min(1)).optional(),
    includeWebsiteAnalysis: z.boolean().default(true),
    includeSocialMediaAnalysis: z.boolean().default(true),
    /** Total search-task budget for this discovery run */
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    advancedSettings: DiscoveryAdvancedSettingsSchema.optional(),
    requestedByUserId: z.string().min(1).optional(),
  })
  .strict()
  .refine((data) => data.icpProfileIds?.length || data.icpProfileId, {
    message: 'Either icpProfileIds or icpProfileId is required',
  });

export const CreateDiscoveryRunResponseSchema = z
  .object({
    runId: z.string(),
    status: DiscoveryPipelineRunStatusSchema,
  })
  .strict();

export const DiscoveryRunStatusResponseSchema = z
  .object({
    runId: z.string(),
    runType: z.literal('DISCOVERY'),
    status: DiscoveryPipelineRunStatusSchema,
    totalItems: z.number().int().min(0),
    processedItems: z.number().int().min(0),
    failedItems: z.number().int().min(0),
    startedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
    errorMessage: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    currentStage: z.string().nullable().optional(),
  })
  .strict();

export const ListDiscoveryRecordsQuerySchema = z
  .object({
    icpProfileId: z.string().min(1).optional(),
    leadId: z.string().min(1).optional(),
    provider: DiscoveryProviderSchema.optional(),
    status: DiscoveryRecordStatusSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    includeQualityMetrics: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const DiscoveryQualityMetricsSchema = z
  .object({
    validEmailCount: z.number().int().min(0),
    validDomainCount: z.number().int().min(0),
    industryMatchRate: z.number().min(0).max(1),
    geoMatchRate: z.number().min(0).max(1),
  })
  .strict();

export const LeadDiscoveryRecordResponseSchema = z
  .object({
    id: z.string(),
    leadId: z.string(),
    icpProfileId: z.string(),
    provider: DiscoveryRecordProviderSchema,
    providerSource: z.string().nullable().optional(),
    providerConfidence: z.number().nullable().optional(),
    providerRecordId: z.string(),
    providerCursor: z.string().nullable(),
    queryHash: z.string(),
    status: DiscoveryRecordStatusSchema,
    rawPayload: z.unknown(),
    provenanceJson: z.unknown().nullable().optional(),
    errorMessage: z.string().nullable(),
    discoveredAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const ListDiscoveryRecordsResponseSchema = z
  .object({
    items: z.array(LeadDiscoveryRecordResponseSchema),
    qualityMetrics: DiscoveryQualityMetricsSchema.nullable().optional(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const CostEventProviderSchema = z.enum([
  'SERPAPI',
  'GOOGLE_PLACES',
  'APOLLO',
  'APIFY_WEBSITE',
  'APIFY_INSTAGRAM',
  'HUNTER',
]);

export const DiscoveryCostSummarySchema = z
  .object({
    totalCostCents: z.number().int().min(0),
    perLeadCostCents: z.number().min(0),
    breakdown: z.array(
      z.object({
        provider: CostEventProviderSchema,
        callCount: z.number().int().min(0),
        totalCostCents: z.number().int().min(0),
      }),
    ),
  })
  .strict();

export type DiscoveryProvider = z.infer<typeof DiscoveryProviderSchema>;
export type DiscoveryRecordProvider = z.infer<typeof DiscoveryRecordProviderSchema>;
export type DiscoveryRecordStatus = z.infer<typeof DiscoveryRecordStatusSchema>;
export type PipelineRunStatus = z.infer<typeof DiscoveryPipelineRunStatusSchema>;
export type CreateDiscoveryRunRequest = z.infer<typeof CreateDiscoveryRunRequestSchema>;
export type CreateDiscoveryRunResponse = z.infer<typeof CreateDiscoveryRunResponseSchema>;
export type DiscoveryRunStatusResponse = z.infer<typeof DiscoveryRunStatusResponseSchema>;
export type ListDiscoveryRecordsQuery = z.infer<typeof ListDiscoveryRecordsQuerySchema>;
export type LeadDiscoveryRecordResponse = z.infer<typeof LeadDiscoveryRecordResponseSchema>;
export type DiscoveryQualityMetrics = z.infer<typeof DiscoveryQualityMetricsSchema>;
export type ListDiscoveryRecordsResponse = z.infer<typeof ListDiscoveryRecordsResponseSchema>;
// ── List Discovery Runs ─────────────────────────────────────────────────
export const ListDiscoveryRunsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const DiscoveryRunSummarySchema = z
  .object({
    runId: z.string(),
    status: DiscoveryPipelineRunStatusSchema,
    totalItems: z.number().int().min(0),
    processedItems: z.number().int().min(0),
    failedItems: z.number().int().min(0),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    icpProfileId: z.string().nullable(),
    icpProfileIds: z.array(z.string()).optional(),
    countries: z.array(z.string()),
    limit: z.number().int().min(0),
    converted: z.number().int().min(0).optional(),
    errorMessage: z.string().nullable(),
    currentStage: z.string().nullable().optional(),
  })
  .strict();

export const ListDiscoveryRunsResponseSchema = z
  .object({
    runs: z.array(DiscoveryRunSummarySchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

// ── Pipeline Stats ──────────────────────────────────────────────────────
export const PipelineStatsResponseSchema = z
  .object({
    leadDistribution: z.object({
      discovered: z.number().int().min(0),
      enriched: z.number().int().min(0),
      scored: z.number().int().min(0),
      messaged: z.number().int().min(0),
    }),
    pendingApprovals: z.number().int().min(0),
  })
  .strict();

export type CostEventProvider = z.infer<typeof CostEventProviderSchema>;
export type DiscoveryCostSummary = z.infer<typeof DiscoveryCostSummarySchema>;
export type DiscoveryAdvancedSettings = z.infer<typeof DiscoveryAdvancedSettingsSchema>;
export type ListDiscoveryRunsQuery = z.infer<typeof ListDiscoveryRunsQuerySchema>;
export type DiscoveryRunSummary = z.infer<typeof DiscoveryRunSummarySchema>;
export type ListDiscoveryRunsResponse = z.infer<typeof ListDiscoveryRunsResponseSchema>;
export type PipelineStatsResponse = z.infer<typeof PipelineStatsResponseSchema>;
