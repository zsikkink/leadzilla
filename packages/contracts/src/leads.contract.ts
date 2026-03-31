import { z } from 'zod';

export const LeadStatusSchema = z.enum(['new', 'processing', 'enriched', 'scored', 'qualified', 'drafted', 'rejected', 'stuck', 'failed', 'messaged', 'replied', 'cold']);
export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const LeadScoreBandSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export const LeadContactDiscoverySourceFamilySchema = z.enum(['linkedin', 'company_page', 'public_web', 'mixed', 'unknown']);
export const LeadContactDiscoveryOutcomeSchema = z.enum(['lead_created', 'recovery_opened', 'no_contact_terminal']);
export const LeadContactVerificationVerdictSchema = z.enum(['verified', 'not_verified', 'inconclusive', 'skipped']);
export const LeadContactDiscoveryQueryFamilySchema = z.enum(['DISCOVER_ROLES']);
export const LeadContactTerminalReasonSchema = z.enum([
  'no_named_candidate_found',
  'named_candidate_no_email',
  'email_inferred_failed_verification',
  'ambiguous_winner',
]);

export const LeadContactDiscoveryDiagnosticSchema = z
  .object({
    stage: z.string().min(1),
    sourceFamily: LeadContactDiscoverySourceFamilySchema,
    queryFamily: LeadContactDiscoveryQueryFamilySchema,
    rawResultCount: z.number().int().min(0),
    promotedCount: z.number().int().min(0),
    verdict: LeadContactVerificationVerdictSchema,
  })
  .strict();

export const LeadContactDiscoveryCandidateSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().nullable(),
    sourceStage: z.string().nullable(),
    linkedinUrl: z.string().url().nullable(),
    email: z.string().email().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    matchedSignals: z.array(z.string()),
    verificationVerdict: LeadContactVerificationVerdictSchema,
    supportingUrls: z.array(z.string().url()),
  })
  .strict();

export const LeadContactDiscoverySchema = z
  .object({
    cseVerifyAttempted: z.boolean(),
    cseVerifySucceeded: z.boolean(),
    cseDiscoverAttempted: z.boolean(),
    cseDiscoverSucceeded: z.boolean(),
    cseRawResults: z.number().int().min(0),
    cseValidProfiles: z.number().int().min(0),
    cseCandidatesAdded: z.number().int().min(0),
    cseCandidatesValidated: z.number().int().min(0),
    cseEmailsInferred: z.number().int().min(0),
    topSourceFamily: LeadContactDiscoverySourceFamilySchema,
    finalOutcome: LeadContactDiscoveryOutcomeSchema,
    verificationVerdict: LeadContactVerificationVerdictSchema,
    supportingUrls: z.array(z.string().url()),
    diagnostics: z.array(LeadContactDiscoveryDiagnosticSchema),
    topQueryFamily: LeadContactDiscoveryQueryFamilySchema.nullable(),
    topCandidates: z.array(LeadContactDiscoveryCandidateSchema),
    identityConfidence: z.number().min(0).max(1).nullable().optional(),
    contactConfidence: z.number().min(0).max(1).nullable().optional(),
    terminalReason: LeadContactTerminalReasonSchema.nullable().optional(),
    resolutionState: z.enum(['lead_created', 'inconclusive_but_promising', 'no_contact_terminal']).nullable().optional(),
    winnerSelectionMethod: z.enum(['deterministic', 'llm']).nullable().optional(),
    adjudication: z
      .object({
        verdict: z.enum(['select_candidate', 'inconclusive', 'reject_all']),
        selectedCandidateId: z.string().nullable(),
        confidenceBucket: z.enum(['high', 'medium', 'low']).nullable(),
        rationale: z.string(),
      })
      .nullable()
      .optional(),
  })
  .strict();

export const CreateLeadRequestSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  source: z.string().min(1),
  icpProfileId: z.string().optional(),
});

export const CreateLeadResponseSchema = z.object({
  leadId: z.string().min(1),
  jobId: z.string().min(1),
});

export const GetLeadResponseSchema = z.object({
  id: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string().email(),
  source: z.string().min(1),
  status: LeadStatusSchema,
  enrichmentData: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  businessCountryCode: z.string().nullable().optional(),
  businessCountry: z.string().nullable().optional(),
  businessCity: z.string().nullable().optional(),
  businessCategory: z.string().nullable().optional(),
  latestIcpProfileId: z.string().nullable().optional(),
  phoneSource: z.string().nullable().optional(),
  businessEmail: z.string().nullable().optional(),
  contactDiscovery: LeadContactDiscoverySchema.nullable().optional(),
  businessId: z.string().nullable().optional(),
  websiteDomain: z.string().nullable().optional(),
  icpProfileName: z.string().nullable().optional(),
});

export const GetJobStatusResponseSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  status: JobStatusSchema,
  attempts: z.number().int().nonnegative(),
  leadId: z.string().nullable(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export const ListLeadsQuerySchema = z
  .object({
    icpProfileId: z.string().min(1).optional(),
    status: LeadStatusSchema.optional(),
    scoreBand: LeadScoreBandSchema.optional(),
    minBlendedScore: z.coerce.number().min(0).max(1).optional(),
    includeRejected: z.coerce.boolean().default(false).optional(),
    search: z.string().max(200).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    includeQualityMetrics: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const LeadInspectionQualityMetricsSchema = z
  .object({
    validEmailCount: z.number().int().min(0),
    validDomainCount: z.number().int().min(0),
    industryMatchRate: z.number().min(0).max(1),
    geoMatchRate: z.number().min(0).max(1),
  })
  .strict();

export const LeadInspectionResponseSchema = z
  .object({
    id: z.string().min(1),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string().email(),
    source: z.string().min(1),
    status: LeadStatusSchema,
    error: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    latestIcpProfileId: z.string().nullable(),
    latestScoreBand: LeadScoreBandSchema.nullable(),
    latestBlendedScore: z.number().nullable(),
    latestScorePredictionId: z.string().nullable(),
    latestDiscoveryRawPayload: z.unknown().nullable(),
    latestEnrichmentNormalizedPayload: z.unknown().nullable(),
    latestEnrichmentRawPayload: z.unknown().nullable(),
    businessCountryCode: z.string().nullable(),
    businessCountry: z.string().nullable(),
    businessCity: z.string().nullable(),
    businessCategory: z.string().nullable(),
    businessName: z.string().nullable().optional(),
    decisionMakerTitle: z.string().nullable().optional(),
  })
  .strict();

export const ListLeadsResponseSchema = z
  .object({
    items: z.array(LeadInspectionResponseSchema),
    qualityMetrics: LeadInspectionQualityMetricsSchema.nullable().optional(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export type LeadStatus = z.infer<typeof LeadStatusSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type LeadContactDiscoverySourceFamily = z.infer<typeof LeadContactDiscoverySourceFamilySchema>;
export type LeadContactDiscoveryOutcome = z.infer<typeof LeadContactDiscoveryOutcomeSchema>;
export type LeadContactVerificationVerdict = z.infer<typeof LeadContactVerificationVerdictSchema>;
export type LeadContactDiscoveryQueryFamily = z.infer<typeof LeadContactDiscoveryQueryFamilySchema>;
export type LeadContactTerminalReason = z.infer<typeof LeadContactTerminalReasonSchema>;
export type LeadContactDiscoveryDiagnostic = z.infer<typeof LeadContactDiscoveryDiagnosticSchema>;
export type LeadContactDiscoveryCandidate = z.infer<typeof LeadContactDiscoveryCandidateSchema>;
export type LeadContactDiscovery = z.infer<typeof LeadContactDiscoverySchema>;
export type CreateLeadRequest = z.infer<typeof CreateLeadRequestSchema>;
export type CreateLeadResponse = z.infer<typeof CreateLeadResponseSchema>;
export type GetLeadResponse = z.infer<typeof GetLeadResponseSchema>;
export type GetJobStatusResponse = z.infer<typeof GetJobStatusResponseSchema>;
export type LeadScoreBand = z.infer<typeof LeadScoreBandSchema>;
export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;
export type LeadInspectionResponse = z.infer<typeof LeadInspectionResponseSchema>;
export type LeadInspectionQualityMetrics = z.infer<typeof LeadInspectionQualityMetricsSchema>;
export type ListLeadsResponse = z.infer<typeof ListLeadsResponseSchema>;
