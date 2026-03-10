import { z } from 'zod';

import {
  LeadContactDiscoveryDiagnosticSchema,
  LeadContactDiscoveryQueryFamilySchema,
  LeadContactDiscoverySourceFamilySchema,
  LeadContactTerminalReasonSchema,
  LeadContactVerificationVerdictSchema,
  LeadScoreBandSchema,
} from './leads.contract.js';

export const ContactRecoveryStatusSchema = z.enum(['OPEN', 'REJECTED']);
export const ContactRecoveryReasonSchema = z.enum(['NO_CONTACTS_FOUND', 'NO_EMAIL', 'DECISION_MAKER_IDENTIFIED']);
export const ContactRecoveryOutcomeSchema = z.enum(['lead_created', 'recovery_opened', 'no_contact_terminal']);

export const ContactRecoveryAttemptSchema = z
  .object({
    stage: z.string().min(1),
    provider: z.string().min(1),
    mode: z.string().nullable(),
    status: z.string().min(1),
    resultCount: z.number().int().min(0).nullable(),
    notes: z.array(z.string()).default([]),
  })
  .strict();

export const ContactRecoveryCandidateSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().nullable(),
    source: z.string().min(1),
    sourceStage: z.string().nullable(),
    seniority: z.string().min(1),
    confidence: z.number().min(0).max(1).nullable(),
    linkedinUrl: z.string().url().nullable(),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    matchedSignals: z.array(z.string()),
    evidenceScore: z.number().min(0).max(1),
    isSendable: z.boolean(),
    verificationVerdict: LeadContactVerificationVerdictSchema.default('skipped'),
    supportingUrls: z.array(z.string().url()).default([]),
  })
  .strict();

export const ContactRecoveryTelemetrySchema = z
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
    finalOutcome: ContactRecoveryOutcomeSchema,
    verificationVerdict: LeadContactVerificationVerdictSchema.default('skipped'),
    supportingUrls: z.array(z.string().url()).default([]),
    diagnostics: z.array(LeadContactDiscoveryDiagnosticSchema).default([]),
    topQueryFamily: LeadContactDiscoveryQueryFamilySchema.nullable().default(null),
  })
  .strict();

export const ContactRecoverySnapshotSchema = z
  .object({
    businessId: z.string().min(1),
    domain: z.string().nullable(),
    locality: z.string().nullable(),
    generatedAt: z.string().datetime(),
    businessInsights: z.string().nullable(),
    genericBusinessEmail: z.string().email().nullable(),
    telemetry: ContactRecoveryTelemetrySchema,
    attempts: z.array(ContactRecoveryAttemptSchema),
    topCandidates: z.array(ContactRecoveryCandidateSchema),
    websiteIntelligence: z.unknown().nullable(),
    instagramIntelligence: z.unknown().nullable(),
    identityConfidence: z.number().min(0).max(1).nullable().optional(),
    contactConfidence: z.number().min(0).max(1).nullable().optional(),
    terminalReason: LeadContactTerminalReasonSchema.nullable().optional(),
    resolutionState: z.enum(['inconclusive_but_promising', 'no_contact_terminal', 'lead_created']).nullable().optional(),
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

export const ContactRecoveryBusinessSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    city: z.string().nullable(),
    country: z.string().nullable(),
    countryCode: z.string().nullable(),
    websiteDomain: z.string().nullable(),
    instagramHandle: z.string().nullable(),
    category: z.string().nullable(),
    deterministicScore: z.number().nullable(),
    scoreBand: LeadScoreBandSchema.nullable(),
    preQualified: z.boolean().nullable(),
    disqualificationReason: z.string().nullable(),
  })
  .strict();

export const ContactRecoveryItemSchema = z
  .object({
    id: z.string().min(1),
    businessId: z.string().min(1),
    icpProfileId: z.string().min(1),
    icpProfileName: z.string().nullable(),
    discoveryRunId: z.string().min(1),
    status: ContactRecoveryStatusSchema,
    reason: ContactRecoveryReasonSchema,
    evidenceScore: z.number().min(0).max(1),
    candidateCount: z.number().int().min(0),
    rejectedBy: z.string().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    business: ContactRecoveryBusinessSummarySchema,
    snapshot: ContactRecoverySnapshotSchema,
  })
  .strict();

export const ContactRecoveryDetailResponseSchema = ContactRecoveryItemSchema;

export const ListContactRecoveryItemsQuerySchema = z
  .object({
    status: ContactRecoveryStatusSchema.optional(),
    icpProfileId: z.string().min(1).optional(),
    q: z.string().min(1).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const ListContactRecoveryItemsResponseSchema = z
  .object({
    items: z.array(ContactRecoveryItemSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  })
  .strict();

export const ContactRecoveryIdParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const RejectContactRecoveryRequestSchema = z
  .object({
    reason: z.string().min(1).optional(),
  })
  .strict();

export type ContactRecoveryStatus = z.infer<typeof ContactRecoveryStatusSchema>;
export type ContactRecoveryReason = z.infer<typeof ContactRecoveryReasonSchema>;
export type ContactRecoveryOutcome = z.infer<typeof ContactRecoveryOutcomeSchema>;
export type ContactRecoveryAttempt = z.infer<typeof ContactRecoveryAttemptSchema>;
export type ContactRecoveryCandidate = z.infer<typeof ContactRecoveryCandidateSchema>;
export type ContactRecoveryTelemetry = z.infer<typeof ContactRecoveryTelemetrySchema>;
export type ContactRecoverySnapshot = z.infer<typeof ContactRecoverySnapshotSchema>;
export type ContactRecoveryBusinessSummary = z.infer<typeof ContactRecoveryBusinessSummarySchema>;
export type ContactRecoveryItem = z.infer<typeof ContactRecoveryItemSchema>;
export type ContactRecoveryDetailResponse = z.infer<typeof ContactRecoveryDetailResponseSchema>;
export type ListContactRecoveryItemsQuery = z.infer<typeof ListContactRecoveryItemsQuerySchema>;
export type ListContactRecoveryItemsResponse = z.infer<typeof ListContactRecoveryItemsResponseSchema>;
export type RejectContactRecoveryRequest = z.infer<typeof RejectContactRecoveryRequestSchema>;
