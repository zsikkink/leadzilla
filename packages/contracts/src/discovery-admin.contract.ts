import { z } from 'zod';

import { DiscoveryPipelineRunStatusSchema } from './discovery.contract.js';

const CsvStringListSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (Array.isArray(value)) {
    return value;
  }
  return value;
}, z.array(z.string().min(1)).max(50));

const OptionalCsvStringListSchema = CsvStringListSchema.optional();

export const AdminLeadSortBySchema = z.enum(['score_desc', 'recent', 'review_count', 'newest']);
export const SearchTaskSortBySchema = z.enum(['updated_desc', 'run_after_asc', 'attempts_desc']);
export const SearchTaskTypeSchema = z.enum(['SERP_GOOGLE', 'SERP_GOOGLE_LOCAL', 'SERP_MAPS_LOCAL']);
export const SearchTaskStatusSchema = z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED']);
export const JobRunStatusSchema = z.enum(['RUNNING', 'SUCCESS', 'FAILED', 'CANCELED']);
export const JobRequestTypeSchema = z.enum(['DISCOVERY_SEED', 'DISCOVERY_RUN']);
export const JobRequestStatusSchema = z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELED']);

export const AdminBulkCreateDiscoveryRunsRequestSchema = z
  .object({
    items: z.array(z.unknown()).min(1),
  })
  .strict();

export const AdminBulkCreateDiscoveryRunsResultSchema = z.discriminatedUnion('success', [
  z
    .object({
      index: z.number().int().min(0),
      success: z.literal(true),
      runId: z.string().min(1),
      status: DiscoveryPipelineRunStatusSchema,
    })
    .strict(),
  z
    .object({
      index: z.number().int().min(0),
      success: z.literal(false),
      error: z.string().min(1),
    })
    .strict(),
]);

export const AdminBulkCreateDiscoveryRunsResponseSchema = z
  .object({
    results: z.array(AdminBulkCreateDiscoveryRunsResultSchema),
    createdCount: z.number().int().min(0),
    failedCount: z.number().int().min(0),
  })
  .strict();

export const AdminDiscoveryPhase1IcpLocationSummaryRequestSchema = z
  .object({
    runIds: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();

export const AdminDiscoveryPhase1IcpLocationBasisSchema = z.literal('ASSIGNED_SEARCH_TASK_LOCATION');

export const AdminDiscoveryPhase1IcpLocationSummaryRowSchema = z
  .object({
    icpProfileId: z.string().min(1),
    countryCode: z.string().min(1),
    city: z.string().nullable(),
    assignmentCount: z.number().int().min(0),
    measuredAssignmentCount: z.number().int().min(0),
    phase1PositiveCount: z.number().int().min(0),
    phase1NegativeCount: z.number().int().min(0),
    holdoutAmbiguousCount: z.number().int().min(0),
    excludeOperationalCount: z.number().int().min(0),
    excludeIncompleteCount: z.number().int().min(0),
    measurementCoverageRate: z.number().min(0).max(1),
    phase1PositiveRateAmongMeasuredAssignments: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const AdminDiscoveryPhase1IcpLocationSummaryResponseSchema = z
  .object({
    locationBasis: AdminDiscoveryPhase1IcpLocationBasisSchema,
    cohorts: z.array(AdminDiscoveryPhase1IcpLocationSummaryRowSchema),
  })
  .strict();

export const AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesRequestSchema = z
  .object({
    assignedAtStart: z.string().datetime(),
    assignedAtEnd: z.string().datetime(),
  })
  .strict()
  .refine(
    (value) => new Date(value.assignedAtEnd).getTime() > new Date(value.assignedAtStart).getTime(),
    {
      path: ['assignedAtEnd'],
      message: 'assignedAtEnd must be after assignedAtStart',
    },
  );

export const AdminDiscoveryPhase1SearchInputBasisSchema = z.literal('ASSIGNED_SEARCH_TASK_INPUT');

export const AdminDiscoveryPhase1HistoricalSearchInputCohortSummaryRowSchema = z
  .object({
    icpProfileId: z.string().min(1),
    taskType: SearchTaskTypeSchema,
    countryCode: z.string().min(1),
    city: z.string().nullable(),
    language: z.string().min(1),
    normalizedQueryKey: z.string().min(1),
    queryHash: z.string().min(1),
    page: z.number().int().min(0),
    timeBucket: z.string().min(1),
    discoveryRunCount: z.number().int().min(0),
    assignmentCount: z.number().int().min(0),
    measuredAssignmentCount: z.number().int().min(0),
    phase1PositiveCount: z.number().int().min(0),
    phase1NegativeCount: z.number().int().min(0),
    excludeOperationalCount: z.number().int().min(0),
    excludeIncompleteCount: z.number().int().min(0),
    measurementCoverageRate: z.number().min(0).max(1),
    phase1PositiveRateAmongMeasuredAssignments: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesResponseSchema = z
  .object({
    searchInputBasis: AdminDiscoveryPhase1SearchInputBasisSchema,
    cohorts: z.array(AdminDiscoveryPhase1HistoricalSearchInputCohortSummaryRowSchema),
  })
  .strict();

export const AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsRequestSchema = z
  .object({
    assignedAtStart: z.string().datetime(),
    assignedAtEnd: z.string().datetime(),
    icpProfileId: z.string().min(1),
    taskType: SearchTaskTypeSchema,
    countryCode: z.string().min(1),
    city: z.string().nullable(),
    language: z.string().min(1),
    normalizedQueryKey: z.string().min(1),
    queryHash: z.string().min(1),
    page: z.number().int().min(0),
    timeBucket: z.string().min(1),
  })
  .strict()
  .refine(
    (value) => new Date(value.assignedAtEnd).getTime() > new Date(value.assignedAtStart).getTime(),
    {
      path: ['assignedAtEnd'],
      message: 'assignedAtEnd must be after assignedAtStart',
    },
  );

export const AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentRowSchema = z
  .object({
    assignmentId: z.string().min(1),
    discoveryRunId: z.string().min(1),
    assignedAt: z.string().datetime(),
    icpProfileId: z.string().min(1),
    businessId: z.string().min(1),
    searchTaskId: z.string().min(1),
    primaryOutcomeCode: z.string().min(1).nullable(),
    phase1Class: z.string().min(1),
    exclusionReason: z.string().min(1).nullable(),
    taskType: SearchTaskTypeSchema,
    countryCode: z.string().min(1),
    city: z.string().nullable(),
    language: z.string().min(1),
    queryText: z.string().min(1),
    normalizedQueryKey: z.string().min(1),
    queryHash: z.string().min(1),
    page: z.number().int().min(0),
    timeBucket: z.string().min(1),
  })
  .strict();

export const AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsResponseSchema = z
  .object({
    searchInputBasis: AdminDiscoveryPhase1SearchInputBasisSchema,
    assignments: z.array(AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentRowSchema),
  })
  .strict();

export const AdminListLeadsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: AdminLeadSortBySchema.default('newest'),
    scoreMin: z.coerce.number().min(0).max(1).optional(),
    scoreMax: z.coerce.number().min(0).max(1).optional(),
    countries: OptionalCsvStringListSchema,
    city: z.string().min(1).optional(),
    industries: OptionalCsvStringListSchema,
    hasWhatsapp: z.coerce.boolean().optional(),
    hasInstagram: z.coerce.boolean().optional(),
    acceptsOnlinePayments: z.coerce.boolean().optional(),
    recentlyActive: z.coerce.boolean().optional(),
    minReviewCount: z.coerce.number().int().min(0).optional(),
    minFollowerCount: z.coerce.number().int().min(0).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const AdminLeadRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    countryCode: z.string(),
    city: z.string().nullable(),
    category: z.string().nullable(),
    score: z.number().min(0).max(1),
    scoreTier: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    hasWhatsapp: z.boolean(),
    hasInstagram: z.boolean(),
    acceptsOnlinePayments: z.boolean(),
    reviewCount: z.number().int().nullable(),
    followerCount: z.number().int().nullable(),
    physicalAddressPresent: z.boolean(),
    recentActivity: z.boolean(),
    websiteDomain: z.string().nullable(),
    phoneE164: z.string().nullable(),
    instagramHandle: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AdminListLeadsResponseSchema = z
  .object({
    items: z.array(AdminLeadRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const AdminLeadIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const AdminScoreContributionSchema = z
  .object({
    code: z.string(),
    label: z.string(),
    value: z.union([z.number(), z.boolean(), z.string(), z.null()]),
    weight: z.number(),
    contribution: z.number(),
  })
  .strict();

export const AdminScoreBreakdownSchema = z
  .object({
    total: z.number().min(0).max(1),
    tier: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    contributions: z.array(AdminScoreContributionSchema),
  })
  .strict();

export const AdminLeadTaskSummarySchema = z
  .object({
    id: z.string(),
    taskType: SearchTaskTypeSchema,
    queryText: z.string(),
    countryCode: z.string(),
    city: z.string().nullable(),
    language: z.string(),
    page: z.number().int().min(1),
    timeBucket: z.string(),
    paramsJson: z.unknown(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AdminEvidenceItemSchema = z
  .object({
    id: z.string(),
    sourceType: z.string(),
    sourceUrl: z.string(),
    serpapiResultId: z.string().nullable(),
    rawJson: z.unknown(),
    createdAt: z.string().datetime(),
    searchTask: AdminLeadTaskSummarySchema.nullable(),
  })
  .strict();

export const AdminLeadDetailResponseSchema = z
  .object({
    lead: AdminLeadRowSchema,
    scoreBreakdown: AdminScoreBreakdownSchema,
    evidenceTimeline: z.array(AdminEvidenceItemSchema),
    dedupeKeys: z
      .object({
        websiteDomain: z.string().nullable(),
        phoneE164: z.string().nullable(),
        instagramHandle: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AdminBusinessIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const AdminListBusinessesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(30),
    q: z.string().max(200).optional(),
  })
  .strict();

export const AdminBusinessContactSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string().nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    linkedinUrl: z.string().url().nullable(),
    seniority: z.string(),
    positionRank: z.number().int(),
    source: z.string(),
  })
  .strict();

export const AdminBusinessRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    countryCode: z.string(),
    country: z.string().nullable(),
    city: z.string().nullable(),
    category: z.string().nullable(),
    rating: z.number().nullable(),
    reviewCount: z.number().int().nullable(),
    followerCount: z.number().int().nullable(),
    deterministicScore: z.number().min(0).max(1),
    scoreBand: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
    hasWhatsapp: z.boolean(),
    hasInstagram: z.boolean(),
    acceptsOnlinePayments: z.boolean(),
    recentActivity: z.boolean(),
    websiteDomain: z.string().nullable(),
    phoneE164: z.string().nullable(),
    instagramHandle: z.string().nullable(),
    preQualified: z.boolean().nullable(),
    disqualificationReason: z.string().nullable(),
    apifyWebsiteScrapeJson: z.unknown().nullable(),
    apifyInstagramScrapeJson: z.unknown().nullable(),
    websiteScrapedAt: z.string().datetime().nullable(),
    instagramScrapedAt: z.string().datetime().nullable(),
    manualReviewStatus: z.enum(['OPEN', 'APPROVED', 'REJECTED']).nullable().optional(),
    manualReviewReason: z.string().nullable().optional(),
    manualReviewUpdatedAt: z.string().datetime().nullable().optional(),
    leadBlendedScore: z.number().nullable().optional(),
    leadId: z.string().nullable().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const AdminListBusinessesResponseSchema = z
  .object({
    items: z.array(AdminBusinessRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const AdminBusinessDetailResponseSchema = z
  .object({
    business: AdminBusinessRowSchema,
    selectedContacts: z.array(AdminBusinessContactSchema),
  })
  .strict();

export const AdminListSearchTasksQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: SearchTaskSortBySchema.default('updated_desc'),
    status: SearchTaskStatusSchema.optional(),
    taskType: SearchTaskTypeSchema.optional(),
    countryCode: z.string().min(2).max(3).optional(),
    timeBucket: z.string().min(1).optional(),
  })
  .strict();

export const AdminSearchTaskRowSchema = z
  .object({
    id: z.string(),
    taskType: SearchTaskTypeSchema,
    status: SearchTaskStatusSchema,
    countryCode: z.string(),
    city: z.string().nullable(),
    language: z.string(),
    queryText: z.string(),
    timeBucket: z.string(),
    attempts: z.number().int().min(0),
    runAfter: z.string().datetime(),
    lastResultHash: z.string().nullable(),
    error: z.string().nullable(),
    updatedAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const AdminListSearchTasksResponseSchema = z
  .object({
    items: z.array(AdminSearchTaskRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const AdminSearchTaskIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const AdminSearchTaskLinkedLeadSchema = z
  .object({
    businessId: z.string(),
    name: z.string(),
    countryCode: z.string(),
    city: z.string().nullable(),
    category: z.string().nullable(),
    score: z.number().min(0).max(1),
    evidenceId: z.string(),
    evidenceCreatedAt: z.string().datetime(),
  })
  .strict();

export const AdminSearchTaskDetailResponseSchema = z
  .object({
    task: AdminSearchTaskRowSchema.extend({
      paramsJson: z.unknown(),
      page: z.number().int().min(1),
      derivedParams: z
        .object({
          engine: z.string().nullable(),
          q: z.string().nullable(),
          location: z.string().nullable(),
          gl: z.string().nullable(),
          hl: z.string().nullable(),
          z: z.union([z.string(), z.number()]).nullable(),
          m: z.union([z.string(), z.number()]).nullable(),
          start: z.union([z.string(), z.number()]).nullable(),
        })
        .strict(),
    }),
    linkedLeads: z.array(AdminSearchTaskLinkedLeadSchema),
  })
  .strict();

export const RunDiscoverySeedRequestSchema = z
  .object({
    profile: z.enum(['default', 'small']).default('small'),
    maxTasks: z.number().int().min(1).max(2000).optional(),
    maxPages: z.number().int().min(1).max(10).optional(),
    bucket: z.string().min(1).max(64).optional(),
    taskTypes: z.array(SearchTaskTypeSchema).max(3).optional(),
    countries: z.array(z.string().min(2).max(3)).max(8).optional(),
    languages: z.array(z.string().min(2).max(5)).max(8).optional(),
  })
  .strict();

export const RunDiscoveryTasksRequestSchema = z
  .object({
    maxTasks: z.number().int().min(1).max(2000).default(40),
    concurrency: z.number().int().min(1).max(10).optional(),
    timeBucket: z.string().min(1).optional(),
  })
  .strict();

export const TriggerJobRunResponseSchema = z
  .object({
    jobRunId: z.string(),
    status: JobRunStatusSchema,
  })
  .strict();

export const JobRunListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    jobName: z.string().min(1).optional(),
    status: JobRunStatusSchema.optional(),
  })
  .strict();

export const JobRunIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const JobRunItemSchema = z
  .object({
    id: z.string(),
    jobName: z.string(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    durationMs: z.number().int().nullable(),
    status: JobRunStatusSchema,
    paramsJson: z.unknown(),
    countersJson: z.unknown().nullable(),
    resourceJson: z.unknown().nullable(),
    errorText: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const ListJobRunsResponseSchema = z
  .object({
    items: z.array(JobRunItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const JobRunDetailResponseSchema = z
  .object({
    run: JobRunItemSchema,
  })
  .strict();

export const JobRequestListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: JobRequestStatusSchema.optional(),
    requestType: JobRequestTypeSchema.optional(),
  })
  .strict();

export const JobRequestRowSchema = z
  .object({
    id: z.number().int().nonnegative(),
    requestType: JobRequestTypeSchema,
    status: JobRequestStatusSchema,
    paramsJson: z.any(),
    requestedBy: z.string(),
    claimedBy: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    claimedAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    errorText: z.string().nullable(),
    jobRunId: z.string().nullable(),
    idempotencyKey: z.string().nullable(),
  })
  .strict();

export const JobRequestListResponseSchema = z
  .object({
    items: z.array(JobRequestRowSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .strict();

export type AdminLeadSortBy = z.infer<typeof AdminLeadSortBySchema>;
export type SearchTaskSortBy = z.infer<typeof SearchTaskSortBySchema>;
export type SearchTaskType = z.infer<typeof SearchTaskTypeSchema>;
export type SearchTaskStatus = z.infer<typeof SearchTaskStatusSchema>;
export type JobRunStatus = z.infer<typeof JobRunStatusSchema>;
export type JobRequestType = z.infer<typeof JobRequestTypeSchema>;
export type JobRequestStatus = z.infer<typeof JobRequestStatusSchema>;
export type AdminBulkCreateDiscoveryRunsRequest = z.infer<typeof AdminBulkCreateDiscoveryRunsRequestSchema>;
export type AdminBulkCreateDiscoveryRunsResult = z.infer<typeof AdminBulkCreateDiscoveryRunsResultSchema>;
export type AdminBulkCreateDiscoveryRunsResponse = z.infer<typeof AdminBulkCreateDiscoveryRunsResponseSchema>;
export type AdminDiscoveryPhase1IcpLocationSummaryRequest = z.infer<
  typeof AdminDiscoveryPhase1IcpLocationSummaryRequestSchema
>;
export type AdminDiscoveryPhase1IcpLocationBasis = z.infer<
  typeof AdminDiscoveryPhase1IcpLocationBasisSchema
>;
export type AdminDiscoveryPhase1IcpLocationSummaryRow = z.infer<
  typeof AdminDiscoveryPhase1IcpLocationSummaryRowSchema
>;
export type AdminDiscoveryPhase1IcpLocationSummaryResponse = z.infer<
  typeof AdminDiscoveryPhase1IcpLocationSummaryResponseSchema
>;
export type AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesRequest = z.infer<
  typeof AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesRequestSchema
>;
export type AdminDiscoveryPhase1SearchInputBasis = z.infer<
  typeof AdminDiscoveryPhase1SearchInputBasisSchema
>;
export type AdminDiscoveryPhase1HistoricalSearchInputCohortSummaryRow = z.infer<
  typeof AdminDiscoveryPhase1HistoricalSearchInputCohortSummaryRowSchema
>;
export type AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesResponse = z.infer<
  typeof AdminDiscoveryPhase1HistoricalSearchInputCohortSummariesResponseSchema
>;
export type AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsRequest = z.infer<
  typeof AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsRequestSchema
>;
export type AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentRow = z.infer<
  typeof AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentRowSchema
>;
export type AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsResponse = z.infer<
  typeof AdminDiscoveryPhase1HistoricalSearchInputCohortAssignmentsResponseSchema
>;
export type AdminListLeadsQuery = z.infer<typeof AdminListLeadsQuerySchema>;
export type AdminLeadRow = z.infer<typeof AdminLeadRowSchema>;
export type AdminListLeadsResponse = z.infer<typeof AdminListLeadsResponseSchema>;
export type AdminLeadDetailResponse = z.infer<typeof AdminLeadDetailResponseSchema>;
export type AdminBusinessIdParams = z.infer<typeof AdminBusinessIdParamsSchema>;
export type AdminListBusinessesQuery = z.infer<typeof AdminListBusinessesQuerySchema>;
export type AdminBusinessContact = z.infer<typeof AdminBusinessContactSchema>;
export type AdminBusinessRow = z.infer<typeof AdminBusinessRowSchema>;
export type AdminListBusinessesResponse = z.infer<typeof AdminListBusinessesResponseSchema>;
export type AdminBusinessDetailResponse = z.infer<typeof AdminBusinessDetailResponseSchema>;
export type AdminListSearchTasksQuery = z.infer<typeof AdminListSearchTasksQuerySchema>;
export type AdminSearchTaskRow = z.infer<typeof AdminSearchTaskRowSchema>;
export type AdminListSearchTasksResponse = z.infer<typeof AdminListSearchTasksResponseSchema>;
export type AdminSearchTaskDetailResponse = z.infer<typeof AdminSearchTaskDetailResponseSchema>;
export type RunDiscoverySeedRequest = z.infer<typeof RunDiscoverySeedRequestSchema>;
export type RunDiscoveryTasksRequest = z.infer<typeof RunDiscoveryTasksRequestSchema>;
export type TriggerJobRunResponse = z.infer<typeof TriggerJobRunResponseSchema>;
export type JobRunListQuery = z.infer<typeof JobRunListQuerySchema>;
export type JobRunItem = z.infer<typeof JobRunItemSchema>;
export type ListJobRunsResponse = z.infer<typeof ListJobRunsResponseSchema>;
export type JobRunDetailResponse = z.infer<typeof JobRunDetailResponseSchema>;
export type JobRequestListQuery = z.infer<typeof JobRequestListQuerySchema>;
export type JobRequestRow = z.infer<typeof JobRequestRowSchema>;
export type JobRequestListResponse = z.infer<typeof JobRequestListResponseSchema>;
