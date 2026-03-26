import { PrismaRuntime, prisma, toInputJson, type Prisma } from '@lead-flood/db';
import type {
  ContactRecoveryAttempt,
  ContactRecoveryCandidate,
  ContactRecoveryOutcome,
  ContactRecoverySnapshot,
  ContactRecoveryTelemetry,
} from '@lead-flood/contracts';
import type { Job, SendOptions } from 'pg-boss';

import { RetryableError } from '../errors.js';
import { tryFinalizeDiscoveryRun, checkLeadTargetReached } from '../utils/discovery-run-tracker.js';
import {
  getScoreQualificationThreshold,
  isProviderWithinBudget,
} from '../utils/pipeline-settings.js';
import {
  adjudicateDecisionMakerCandidates,
  extractDecisionMakers,
  type CandidateAdjudicationResult,
  type LlmExtractionConfig,
} from '../utils/llm-extraction.js';

// ── Constants ──────────────────────────────────────────────────────────
export const BUSINESS_CONVERT_JOB_NAME = 'business.convert';

export const BUSINESS_CONVERT_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'business.convert.dead_letter',
};

/** Cache TTL for Apify scrapes — skip if scraped within 7 days. */
const SCRAPE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Generic email patterns — skip these in favor of personal emails. */
const GENERIC_EMAIL_PREFIXES = new Set([
  'info', 'contact', 'hello', 'support', 'admin', 'sales', 'office',
  'help', 'service', 'enquiry', 'inquiry', 'general', 'team', 'mail',
  'noreply', 'no-reply', 'webmaster', 'postmaster', 'marketing',
  'hr', 'finance', 'billing', 'accounts', 'reception', 'feedback',
  'appointments', 'events', 'press', 'media', 'partnerships',
  'careers', 'jobs', 'recruitment',
  'booking', 'bookings', 'inquiries', 'reservations',
  'care', 'customercare', 'customer-care',
]);

// ── Payload & Dependencies ─────────────────────────────────────────────
export interface BusinessConvertJobPayload {
  businessId: string;
  discoveryRunId: string;
  icpProfileId: string;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  correlationId?: string | undefined;
}

interface ApolloContact {
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  title: string | null;
  companyName: string | null;
}

type ApolloContactSearchResult =
  | { status: 'success'; contacts: ApolloContact[] }
  | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
  | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } };

interface HunterContact {
  email: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  type: 'personal' | 'generic' | null;
  confidence: number | null;
  verification: string | null;
}

type ContactResolutionStatus = 'verified' | 'discovered' | 'unresolved';
type ContactVerificationVerdict = 'verified' | 'not_verified' | 'inconclusive' | 'skipped';
type ContactDiscoveryQueryFamily = 'DISCOVER_ROLES';
type ContactDiscoveryRoleKeyword = 'founder' | 'ceo' | 'owner';
type ContactTerminalReason =
  | 'no_named_candidate_found'
  | 'named_candidate_no_email'
  | 'email_inferred_failed_verification'
  | 'ambiguous_winner';
type ContactRecoveryReason = 'NO_CONTACTS_FOUND' | 'NO_EMAIL' | 'DECISION_MAKER_IDENTIFIED';

export interface RecoveryEvidenceStrength {
  evidenceScore: number;
  candidateCount: number;
  linkedinCandidateCount: number;
  sendableCandidateCount: number;
  namedCandidateCount: number;
}

interface ContactRecoveryTelemetryState {
  cseVerifyAttempted: boolean;
  cseVerifySucceeded: boolean;
  cseDiscoverAttempted: boolean;
  cseDiscoverSucceeded: boolean;
  cseRawResults: number;
  cseValidProfiles: number;
  cseCandidatesAdded: number;
  cseCandidatesValidated: number;
  cseEmailsInferred: number;
  topSourceFamily: 'linkedin' | 'company_page' | 'public_web' | 'mixed' | 'unknown';
  finalOutcome: ContactRecoveryOutcome;
  verificationVerdict: ContactVerificationVerdict;
  supportingUrls: string[];
  diagnostics: Array<{
    stage: string;
    sourceFamily: 'linkedin' | 'company_page' | 'public_web' | 'mixed' | 'unknown';
    queryFamily: ContactDiscoveryQueryFamily;
    rawResultCount: number;
    promotedCount: number;
    verdict: ContactVerificationVerdict;
  }>;
  topQueryFamily: ContactDiscoveryQueryFamily | null;
}

async function isDiscoveryRunTerminal(discoveryRunId: string): Promise<boolean> {
  const run = await prisma.jobExecution.findUnique({
    where: { id: discoveryRunId },
    select: { status: true, result: true },
  });
  if (run?.status === 'cancelled' || run?.status === 'completed' || run?.status === 'failed') {
    return true;
  }
  // Also treat as terminal if the lead target has been reached
  const result = run?.result && typeof run.result === 'object' && !Array.isArray(run.result)
    ? run.result as Record<string, unknown>
    : null;
  return result?.leadTargetReached === true;
}

type HunterDomainSearchResult =
  | { status: 'success'; contacts: HunterContact[] }
  | { status: 'retryable_error'; failure: { classification: 'retryable' | 'terminal'; statusCode: number | null; message: string; raw: unknown } }
  | { status: 'terminal_error'; failure: { classification: 'retryable' | 'terminal'; statusCode: number | null; message: string; raw: unknown } };

interface WebsiteScraperResult {
  status: 'success' | 'retryable_error' | 'terminal_error';
  data?: {
    // Original signals
    paymentWidgets: string[];
    hasShopify: boolean;
    platform: string | null;
    hasBookingForm: boolean;
    hasPricingTiers: boolean;
    hasProductCatalog: boolean;
    hasWhatsApp: boolean;
    detectedPlatforms: string[];
    // Multi-page intelligence (v2)
    decisionMakers: Array<{
      name: string;
      title: string | null;
      email: string | null;
      phone: string | null;
      linkedinUrl: string | null;
      seniority: 'executive' | 'director' | 'manager' | 'other';
      positionRank: number;
      source: string;
    }>;
    contactInfo: {
      emails: Array<{ email: string; context: string; pageUrl: string }>;
      phones: Array<{ number: string; type: 'whatsapp' | 'mobile' | 'landline' | 'unknown'; pageUrl: string }>;
      addresses: Array<{ text: string; pageUrl: string }>;
    };
    socialLinks: Array<{
      platform: 'instagram' | 'linkedin' | 'facebook' | 'twitter' | 'tiktok' | 'youtube' | 'whatsapp';
      url: string;
      handle: string | null;
    }>;
    technologies: {
      analytics: string[];
      crm: string[];
      liveChat: string[];
      emailMarketing: string[];
      ecommerce: string[];
      payments: string[];
      cssFrameworks: string[];
      hosting: string[];
    };
    businessSignals: {
      estimatedEmployeeCount: number | null;
      certifications: string[];
      hasClientLogos: boolean;
      hasTestimonials: boolean;
      hasCaseStudies: boolean;
    };
    aboutPageText?: string | null | undefined;
    pagesCrawled: number;
    crawlDurationMs: number;
  } | undefined;
}

interface InstagramScraperResult {
  status: 'success' | 'retryable_error' | 'terminal_error';
  data?: {
    // Original fields
    followerCount: number;
    followingCount: number;
    engagementRate: number | null;
    recentPostCount: number;
    lastPostDate: string | null;
    bio: string | null;
    bioLink: string | null;
    isBusinessAccount: boolean;
    // Authenticated-only fields (v2)
    isVerified: boolean;
    businessCategory: string | null;
    businessEmail: string | null;
    businessPhone: string | null;
    mediaCount: number;
    storyHighlightsCount: number;
    isProfessionalAccount: boolean;
    // Recent posts (v2.1)
    recentPosts?: Array<{
      caption: string;
      likeCount: number;
      commentCount: number;
      postType: 'image' | 'video' | 'carousel';
    }> | undefined;
  } | undefined;
}

interface SmtpVerificationResult {
  email: string;
  status: 'valid' | 'catch_all' | 'invalid' | 'disposable' | 'no_mx' | 'smtp_error' | 'timeout';
  isCatchAll: boolean;
  isDisposable: boolean;
  durationMs: number;
}

interface OpenAiInsightGenerator {
  generateBusinessInsights(businessData: string): Promise<
    | { status: 'success'; data: string }
    | { status: 'retryable_error'; failure: { message: string } }
    | { status: 'terminal_error'; failure: { message: string } }
  >;
  isConfigured: boolean;
}

export interface BusinessConvertJobDependencies {
  apolloAdapter: {
    searchContactsByDomain(domain: string): Promise<ApolloContactSearchResult>;
    preScreenDomain?(domain: string): Promise<
      | { status: 'success'; hasEmail: boolean; hasDirectPhone: boolean; topContactTitle: string | null }
      | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
      | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } }
    >;
    isConfigured: boolean;
  };
  hunterAdapter: {
    searchDomainContacts(domain: string): Promise<HunterDomainSearchResult>;
    isConfigured: boolean;
  };
  websiteScraperAdapter?: {
    scrapeWebsite(domain: string): Promise<WebsiteScraperResult>;
    isConfigured: boolean;
  } | undefined;
  instagramScraperAdapter?: {
    scrapeProfile(handle: string): Promise<InstagramScraperResult>;
    isConfigured: boolean;
  } | undefined;
  smtpVerifier?: {
    verify(email: string): Promise<SmtpVerificationResult>;
    isConfigured: boolean;
  } | undefined;
  openAiAdapter?: OpenAiInsightGenerator | undefined;
  llmExtractionConfig?: LlmExtractionConfig | undefined;
  enqueueFeaturesCompute?: ((payload: {
    runId: string;
    leadId: string;
    icpProfileId: string;
    snapshotVersion: number;
    correlationId?: string | undefined;
  }) => Promise<void>) | undefined;
}

export interface BusinessConvertLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function isCacheValid(scrapedAt: Date | null): boolean {
  if (!scrapedAt) return false;
  return Date.now() - scrapedAt.getTime() < SCRAPE_CACHE_TTL_MS;
}

function scoreCandidateConfidence(input: {
  source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo';
  hasEmail: boolean;
  hasLinkedin: boolean;
  seniority: 'executive' | 'director' | 'manager' | 'other';
}): number {
  let score = 0.35;
  if (input.hasEmail) score += 0.25;
  if (input.hasLinkedin) score += 0.2;
  if (input.source === 'website_scrape') score += 0.1;
  if (input.source === 'apollo') score += 0.05;
  if (input.seniority === 'executive') score += 0.1;
  if (input.seniority === 'director') score += 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function scoreIdentityConfidence(input: {
  candidates: Array<{
    name: string;
    source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo';
    seniority: 'executive' | 'director' | 'manager' | 'other';
    linkedinUrl: string | null;
    confidence?: number | undefined;
  }>;
  businessName: string;
}): number {
  const valid = input.candidates.filter((candidate) => isValidPersonName(candidate.name, input.businessName));
  if (valid.length === 0) return 0;

  const top = valid
    .slice()
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, 3);

  let score = 0.2;
  for (const candidate of top) {
    if (candidate.source === 'website_scrape') score += 0.12;
    if (candidate.linkedinUrl) score += 0.08;
    if (candidate.seniority === 'executive') score += 0.14;
    else if (candidate.seniority === 'director') score += 0.1;
    else if (candidate.seniority === 'manager') score += 0.05;
  }

  return Math.max(0, Math.min(1, Number((score / Math.max(1, top.length)).toFixed(3))));
}

function scoreContactConfidence(input: {
  hasValidatedPersonalEmail: boolean;
  hasGenericEmailFallback: boolean;
  selectedCandidate: {
    confidence?: number | undefined;
    seniority: 'executive' | 'director' | 'manager' | 'other';
    source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo';
  } | null;
}): number {
  if (input.hasValidatedPersonalEmail && input.selectedCandidate) {
    let score = 0.55 + (input.selectedCandidate.confidence ?? 0) * 0.35;
    if (input.selectedCandidate.source === 'hunter' || input.selectedCandidate.source === 'apollo') {
      score += 0.05;
    }
    if (input.selectedCandidate.seniority === 'executive' || input.selectedCandidate.seniority === 'director') {
      score += 0.05;
    }
    return Math.max(0, Math.min(1, Number(score.toFixed(3))));
  }

  if (input.hasGenericEmailFallback) {
    return 0.28;
  }

  return 0.05;
}

function isCredibleNamedCandidate(
  candidate: {
    name: string;
    seniority: 'executive' | 'director' | 'manager' | 'other';
    confidence?: number | undefined;
  },
  businessName: string,
): boolean {
  if (!isValidPersonName(candidate.name, businessName)) {
    return false;
  }
  if (candidate.seniority === 'executive' || candidate.seniority === 'director') {
    return true;
  }
  return (candidate.confidence ?? 0) >= 0.55;
}

function isAmbiguousTopCandidates(
  candidates: Array<{
    confidence?: number | undefined;
    seniority: 'executive' | 'director' | 'manager' | 'other';
    name: string;
  }>,
): boolean {
  if (candidates.length < 2) return false;
  const first = candidates[0];
  const second = candidates[1];
  if (!first || !second) return false;

  const confidenceDiff = Math.abs((first.confidence ?? 0) - (second.confidence ?? 0));
  const seniorityDiff = Math.abs(seniorityRank(first.seniority) - seniorityRank(second.seniority));
  return confidenceDiff <= 0.08 && seniorityDiff <= 1 && first.name.toLowerCase() !== second.name.toLowerCase();
}

async function canSpendOnProviderForBusiness(input: {
  provider: 'HUNTER' | 'APOLLO';
  apiCallType: string;
  businessId: string;
  isHighValueBusiness: boolean;
}): Promise<boolean> {
  if (input.isHighValueBusiness) {
    return true;
  }

  const priorCalls = await prisma.discoveryCostEvent.count({
    where: {
      businessId: input.businessId,
      provider: input.provider,
      apiCallType: input.apiCallType,
    },
  });

  return priorCalls < 1;
}

export function calculateRecoveryEvidenceStrength(input: {
  evidenceScore: number;
  topCandidates: Array<{
    name: string;
    linkedinUrl: string | null;
    email: string | null;
  }>;
}): RecoveryEvidenceStrength {
  return {
    evidenceScore: Number(input.evidenceScore.toFixed(3)),
    candidateCount: input.topCandidates.length,
    linkedinCandidateCount: input.topCandidates.filter((candidate) => candidate.linkedinUrl !== null).length,
    sendableCandidateCount: input.topCandidates.filter((candidate) => candidate.email !== null).length,
    namedCandidateCount: input.topCandidates.filter((candidate) => candidate.name.trim().length > 0).length,
  };
}

export function resolveRecoveryReasonWhenNoPersonalEmail(input: {
  resolvedContact: { positionRank: number } | null;
}): ContactRecoveryReason {
  if (!input.resolvedContact) {
    return 'NO_CONTACTS_FOUND';
  }

  return input.resolvedContact.positionRank <= 1
    ? 'DECISION_MAKER_IDENTIFIED'
    : 'NO_EMAIL';
}

export function hasMaterialRecoveryEvidenceImprovement(
  previous: RecoveryEvidenceStrength | null,
  next: RecoveryEvidenceStrength,
): boolean {
  if (!previous) {
    return true;
  }

  return (
    next.sendableCandidateCount > previous.sendableCandidateCount ||
    next.linkedinCandidateCount > previous.linkedinCandidateCount ||
    next.namedCandidateCount > previous.namedCandidateCount ||
    next.candidateCount > previous.candidateCount ||
    next.evidenceScore - previous.evidenceScore >= 0.05
  );
}

function isGenericEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase();
  if (!prefix) return true;
  return GENERIC_EMAIL_PREFIXES.has(prefix);
}

const PLACEHOLDER_PERSON_NAMES = new Set([
  'john doe',
  'jane doe',
  'test user',
  'test contact',
  'example person',
]);

const WEBSITE_CHROME_PHRASES = [
  'contact us',
  'about us',
  'our team',
  'our services',
  'book now',
  'learn more',
  'limited founder memberships available',
];

const BLOCKED_PERSONAL_EMAIL_DOMAINS = [
  'wixpress.com',
  'sentry.wixpress.com',
  'sentry-next.wixpress.com',
  'example.com',
  'mysite.com',
  'doe.com',
];

const BLOCKED_PERSONAL_EMAIL_PREFIXES = ['example', 'test', 'demo', 'sample'];

export function isJunkPersonalEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const [prefix, domain] = normalized.split('@');
  if (!prefix || !domain) {
    return true;
  }

  if (BLOCKED_PERSONAL_EMAIL_PREFIXES.some((value) => prefix === value || prefix.startsWith(`${value}+`))) {
    return true;
  }

  return BLOCKED_PERSONAL_EMAIL_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

/** Pages that indicate a person-specific context for phone numbers. */
const TEAM_PAGE_PATTERNS = ['/team', '/about', '/about-us', '/our-team', '/people', '/staff'];

/**
 * Determine if a phone number is a generic business line (not a DM's personal line).
 * - If associated with a named person AND found on a team/about page → personal (false)
 * - If no person context → always generic (true), regardless of business size
 * - If person context but from a non-team page → generic (true)
 */
function isGenericPhone(
  _phone: string,
  hasPersonContext: boolean,
  _estimatedEmployees: number | null,
  pageUrl: string | null,
): boolean {
  // No person context = always generic, regardless of business size
  if (!hasPersonContext) return true;

  // Person context exists — only trust phones from team/about pages
  if (pageUrl) {
    const path = pageUrl.toLowerCase();
    if (TEAM_PAGE_PATTERNS.some((p) => path.includes(p))) {
      return false; // Named person on a team/about page → personal
    }
  }

  // Person context but not from a team/about page → treat as generic
  return true;
}

/**
 * Match a scraped email to a decision maker by checking if the email prefix
 * follows common first-name patterns: first.last@, flast@, first@, f.last@,
 * firstlast@, first_last@.
 */
function matchEmailToDecisionMaker(
  email: string,
  decisionMakers: Array<{ name: string; title: string | null; seniority: string }>,
): { confidence: 'HIGH' | 'LOW'; matchedDm: { name: string; title: string | null; seniority: string } } | null {
  const prefix = email.split('@')[0]?.toLowerCase();
  if (!prefix) return null;

  for (const dm of decisionMakers) {
    const { firstName, lastName } = parseName(dm.name);
    const first = firstName.toLowerCase();
    const last = lastName.toLowerCase();

    if (!first) continue;

    const patterns = [
      `${first}.${last}`,     // first.last@
      `${first[0]}${last}`,   // flast@
      first,                  // first@
      `${first[0]}.${last}`,  // f.last@
      `${first}${last}`,      // firstlast@
      `${first}_${last}`,     // first_last@
    ];

    if (last && patterns.some((p) => p === prefix)) {
      return { confidence: 'HIGH', matchedDm: dm };
    }

    // Partial match on first name only (lower confidence)
    if (prefix === first || prefix.startsWith(`${first}.`) || prefix.startsWith(`${first}_`)) {
      return { confidence: 'LOW', matchedDm: dm };
    }
  }

  return null;
}

/**
 * Detect the dominant email pattern from known emails at a domain and generate
 * candidate emails for decision makers using that pattern. Returns SMTP-verified
 * matches only.
 */
async function inferEmailPattern(
  knownEmails: Array<{ email: string; firstName: string; lastName: string }>,
  domain: string,
  decisionMakers: Array<{ name: string; title: string | null; seniority: string }>,
  smtpVerifier: { verify(email: string): Promise<SmtpVerificationResult> } | undefined,
): Promise<{
  matches: Array<{ email: string; dm: { name: string; title: string | null; seniority: string }; pattern: string }>;
  attempted: number;
  failedVerification: number;
  pattern: string | null;
}> {
  if (!smtpVerifier || knownEmails.length === 0 || decisionMakers.length === 0) {
    return { matches: [], attempted: 0, failedVerification: 0, pattern: null };
  }

  // Detect pattern from known emails
  const patternCounts: Record<string, number> = {};

  for (const { email, firstName, lastName } of knownEmails) {
    const prefix = email.split('@')[0]?.toLowerCase();
    const first = firstName.toLowerCase();
    const last = lastName.toLowerCase();
    if (!prefix || !first || !last) continue;

    if (prefix === `${first}.${last}`) patternCounts['first.last'] = (patternCounts['first.last'] ?? 0) + 1;
    else if (prefix === `${first[0]}${last}`) patternCounts['flast'] = (patternCounts['flast'] ?? 0) + 1;
    else if (prefix === first) patternCounts['first'] = (patternCounts['first'] ?? 0) + 1;
    else if (prefix === `${first[0]}.${last}`) patternCounts['f.last'] = (patternCounts['f.last'] ?? 0) + 1;
    else if (prefix === `${first}${last}`) patternCounts['firstlast'] = (patternCounts['firstlast'] ?? 0) + 1;
    else if (prefix === `${first}_${last}`) patternCounts['first_last'] = (patternCounts['first_last'] ?? 0) + 1;
  }

  const dominantPattern = Object.entries(patternCounts)
    .sort(([, a], [, b]) => b - a)[0]?.[0];
  if (!dominantPattern) {
    return { matches: [], attempted: 0, failedVerification: 0, pattern: null };
  }

  // Generate candidates for DMs using the dominant pattern
  const results: Array<{ email: string; dm: { name: string; title: string | null; seniority: string }; pattern: string }> = [];
  let attempted = 0;
  let failedVerification = 0;

  for (const dm of decisionMakers) {
    const { firstName, lastName } = parseName(dm.name);
    const first = firstName.toLowerCase();
    const last = lastName.toLowerCase();
    if (!first || !last) continue;

    let candidate: string | null = null;
    switch (dominantPattern) {
      case 'first.last': candidate = `${first}.${last}@${domain}`; break;
      case 'flast': candidate = `${first[0]}${last}@${domain}`; break;
      case 'first': candidate = `${first}@${domain}`; break;
      case 'f.last': candidate = `${first[0]}.${last}@${domain}`; break;
      case 'firstlast': candidate = `${first}${last}@${domain}`; break;
      case 'first_last': candidate = `${first}_${last}@${domain}`; break;
    }

    if (!candidate) continue;
    attempted += 1;

    const verification = await smtpVerifier.verify(candidate);
    if (verification.status === 'valid' || verification.status === 'catch_all') {
      results.push({ email: candidate, dm, pattern: dominantPattern });
    } else {
      failedVerification += 1;
    }
  }

  return {
    matches: results,
    attempted,
    failedVerification,
    pattern: dominantPattern,
  };
}

/** Seniority rank for sorting decision makers (lower = more senior). */
function seniorityRank(seniority: string | null): number {
  switch (seniority) {
    case 'executive': return 0;
    case 'director': return 1;
    case 'manager': return 2;
    default: return 3;
  }
}

/** Explicit title hierarchy for deterministic decision-maker selection. */
export function getDecisionMakerTier(title: string | null): number {
  if (!title) return 5;

  const lower = title.toLowerCase();

  if (/\b(ceo|chief executive officer|founder|co-founder|cofounder|owner|president|chair(?:man|woman|person)?|chair\b)/i.test(lower)) {
    return 0;
  }

  if (/\b(cfo|chief financial officer|coo|chief operating officer|cto|chief technology officer|cio|chief information officer|cmo|chief marketing officer|cpo|chief product officer|chief people officer|managing director|general manager)\b/i.test(lower)) {
    return 1;
  }

  if (/\b(vp|vice\s*president|head\s+of|head\b|svp|evp)\b/i.test(lower)) {
    return 2;
  }

  if (/\bdirector\b/i.test(lower)) {
    return 3;
  }

  if (/\b(manager|lead|supervisor)\b/i.test(lower)) {
    return 4;
  }

  return 5;
}

/** Classify seniority from a title string (local version for Hunter/Apollo contacts). */
export function classifySeniorityLocal(title: string): 'executive' | 'director' | 'manager' | 'other' {
  const tier = getDecisionMakerTier(title);
  if (tier <= 1) {
    return 'executive';
  }
  if (tier <= 3) {
    return 'director';
  }
  if (tier === 4) {
    return 'manager';
  }
  return 'other';
}

/**
 * Parse a full name into first/last. Handles "John Smith" and "Smith, John".
 */
function parseName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',').map((s) => s.trim());
    return { firstName: first ?? '', lastName: last ?? '' };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0] ?? '', lastName: '' };
  }
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}

// ── Name Validation ──────────────────────────────────────────────────

const CORPORATE_SUFFIXES = new Set([
  'llc', 'inc', 'ltd', 'events', 'company', 'group', 'management',
  'corp', 'enterprise', 'international', 'services', 'solutions',
  'corporation', 'enterprises', 'holdings', 'consulting', 'associates',
]);

const ROLE_WORDS = new Set([
  'expert', 'skilled', 'quality', 'customer', 'support', 'control',
  'senior', 'junior', 'assistant', 'specialist', 'consultant',
  'installer', 'manager', 'technician', 'professional', 'certified',
]);

/**
 * Validate that a name represents a real person, not a company name or role.
 * Returns true if the name passes validation (is likely a real person).
 */
export function isValidPersonName(name: string, businessName: string): boolean {
  const trimmed = name.trim();
  const lowerTrimmed = trimmed.toLowerCase();

  // Length checks
  if (trimmed.length < 2 || trimmed.length > 50) return false;

  // Reject placeholder names
  if (lowerTrimmed === 'unknown contact' || PLACEHOLDER_PERSON_NAMES.has(lowerTrimmed)) return false;

  if (WEBSITE_CHROME_PHRASES.some((phrase) => lowerTrimmed.includes(phrase))) return false;

  // Just numbers or special characters
  if (/^[\d\W]+$/.test(trimmed)) return false;

  // Matches business name (case-insensitive)
  if (lowerTrimmed === businessName.toLowerCase()) return false;

  // All uppercase (company names are often ALL CAPS, e.g., "JOVIAL EVENTS")
  // Allow 2-3 letter names that might be initials
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3) return false;

  const lowerWords = trimmed.toLowerCase().split(/\s+/);

  // Contains corporate suffixes
  for (const word of lowerWords) {
    if (CORPORATE_SUFFIXES.has(word)) return false;
  }

  // Entire name is role words (not when a role word is part of a real name)
  // Strip trailing 's' to catch plurals (e.g. "managers" → "manager")
  if (lowerWords.every((w) => ROLE_WORDS.has(w) || ROLE_WORDS.has(w.replace(/s$/, '')))) return false;

  return true;
}

function dedupeUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.filter((value) => value.length > 0))];
}

async function persistCostEvents(
  db: typeof prisma,
  discoveryRunId: string,
  businessId: string,
  costEvents: Array<{ provider: string; costCents: number; apiCallType: string }>,
): Promise<void> {
  if (costEvents.length === 0) return;
  for (const ce of costEvents) {
    await db.discoveryCostEvent.create({
      data: {
        discoveryRunId,
        provider: ce.provider as Parameters<typeof db.discoveryCostEvent.create>[0]['data']['provider'],
        costCents: ce.costCents,
        apiCallType: ce.apiCallType,
        businessId,
      },
    });
  }
}

function resolveDiscoveryProvider(
  paramsJson: Prisma.JsonValue | null | undefined,
): 'SERPAPI' | 'GOOGLE_PLACES' {
  if (paramsJson && typeof paramsJson === 'object' && !Array.isArray(paramsJson)) {
    const providerUsed = (paramsJson as Record<string, unknown>).providerUsed;
    if (providerUsed === 'GOOGLE_PLACES') {
      return 'GOOGLE_PLACES';
    }
  }
  return 'SERPAPI';
}

function toRecoveryCandidate(input: {
  name: string;
  title: string | null;
  source: string;
  sourceStage?: string | undefined;
  seniority: string;
  confidence?: number | undefined;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  matchedSignals?: string[] | undefined;
  verificationVerdict?: ContactVerificationVerdict | undefined;
  supportingUrls?: string[] | undefined;
}): ContactRecoveryCandidate {
  const evidenceScore = calculateRecoveryEvidenceStrength({
    evidenceScore: input.confidence ?? 0.35,
    topCandidates: [{ name: input.name, linkedinUrl: input.linkedinUrl, email: input.email }],
  }).evidenceScore;

  return {
    name: input.name,
    title: input.title,
    source: input.source,
    sourceStage: input.sourceStage ?? null,
    seniority: input.seniority,
    confidence: input.confidence ?? null,
    linkedinUrl: input.linkedinUrl,
    email: input.email,
    phone: input.phone,
    matchedSignals: input.matchedSignals ?? [],
    evidenceScore,
    isSendable: input.email !== null && !isGenericEmail(input.email),
    verificationVerdict: input.verificationVerdict ?? 'skipped',
    supportingUrls: dedupeUrls(input.supportingUrls ?? []),
  };
}

function extractStrengthFromSnapshot(snapshot: ContactRecoverySnapshot): RecoveryEvidenceStrength {
  return calculateRecoveryEvidenceStrength({
    evidenceScore: snapshot.topCandidates[0]?.evidenceScore ?? 0,
    topCandidates: snapshot.topCandidates,
  });
}

function buildContactRecoverySnapshot(input: {
  businessId: string;
  domain: string;
  locality: string | null;
  businessInsights: string | null;
  genericBusinessEmail: string | null;
  telemetry: ContactRecoveryTelemetry;
  attempts: ContactRecoveryAttempt[];
  topCandidates: ContactRecoveryCandidate[];
  websiteIntelligence: unknown;
  instagramIntelligence: unknown;
  identityConfidence: number;
  contactConfidence: number;
  terminalReason: ContactTerminalReason;
  resolutionState: 'inconclusive_but_promising' | 'no_contact_terminal';
  adjudication: CandidateAdjudicationResult | null;
}): ContactRecoverySnapshot {
  return {
    businessId: input.businessId,
    domain: input.domain,
    locality: input.locality,
    generatedAt: new Date().toISOString(),
    businessInsights: input.businessInsights,
    genericBusinessEmail: input.genericBusinessEmail,
    telemetry: input.telemetry,
    attempts: input.attempts,
    topCandidates: input.topCandidates,
    websiteIntelligence: input.websiteIntelligence,
    instagramIntelligence: input.instagramIntelligence,
    identityConfidence: Number(input.identityConfidence.toFixed(3)),
    contactConfidence: Number(input.contactConfidence.toFixed(3)),
    terminalReason: input.terminalReason,
    resolutionState: input.resolutionState,
    adjudication: input.adjudication,
  };
}

async function upsertContactRecoveryItem(input: {
  businessId: string;
  icpProfileId: string;
  discoveryRunId: string;
  reason: ContactRecoveryReason;
  snapshot: ContactRecoverySnapshot;
}): Promise<void> {
  const nextStrength = extractStrengthFromSnapshot(input.snapshot);
  const existing = await prisma.contactRecoveryItem.findUnique({
    where: {
      businessId_icpProfileId: {
        businessId: input.businessId,
        icpProfileId: input.icpProfileId,
      },
    },
    select: {
      id: true,
      status: true,
      recoverySnapshot: true,
    },
  });

  const previousSnapshot =
    existing?.recoverySnapshot && typeof existing.recoverySnapshot === 'object' && !Array.isArray(existing.recoverySnapshot)
      ? existing.recoverySnapshot as ContactRecoverySnapshot
      : null;
  const shouldReopen = existing?.status === 'REJECTED'
    ? hasMaterialRecoveryEvidenceImprovement(
        previousSnapshot ? extractStrengthFromSnapshot(previousSnapshot) : null,
        nextStrength,
      )
    : false;

  if (existing?.status === 'REJECTED' && !shouldReopen) {
    return;
  }

  await prisma.contactRecoveryItem.upsert({
    where: {
      businessId_icpProfileId: {
        businessId: input.businessId,
        icpProfileId: input.icpProfileId,
      },
    },
    create: {
      businessId: input.businessId,
      icpProfileId: input.icpProfileId,
      discoveryRunId: input.discoveryRunId,
      status: 'OPEN',
      reason: input.reason,
      evidenceScore: nextStrength.evidenceScore,
      candidateCount: nextStrength.candidateCount,
      recoverySnapshot: toInputJson(input.snapshot),
    },
    update: {
      discoveryRunId: input.discoveryRunId,
      status: 'OPEN',
      reason: input.reason,
      evidenceScore: nextStrength.evidenceScore,
      candidateCount: nextStrength.candidateCount,
      recoverySnapshot: toInputJson(input.snapshot),
      rejectedBy: null,
      rejectedAt: null,
    },
  });
}

// ── Handler ─────────────────────────────────────────────────────────────
export async function handleBusinessConvertJob(
  logger: BusinessConvertLogger,
  job: Job<BusinessConvertJobPayload>,
  deps?: BusinessConvertJobDependencies,
): Promise<void> {
  const {
    businessId,
    discoveryRunId,
    icpProfileId,
    includeWebsiteAnalysis,
    includeSocialMediaAnalysis,
    correlationId,
  } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;

  const logCtx = {
    jobId: job.id,
    queue: job.name,
    businessId,
    discoveryRunId,
    icpProfileId,
    correlationId: effectiveCorrelationId,
  };
  const trackerSelfExclusion = { excludeActiveJobId: job.id };

  logger.info(logCtx, 'Started business.convert job');

  if (await isDiscoveryRunTerminal(discoveryRunId)) {
    logger.warn(logCtx, 'Discovery run already terminal — skipping conversion');
    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
    return;
  }

  // ── 1. Load business ──────────────────────────────────────────────────
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      websiteDomain: true,
      instagramHandle: true,
      phoneE164: true,
      reviewCount: true,
      address: true,
      city: true,
      countryCode: true,
      category: true,
      apifyWebsiteScrapeJson: true,
      apifyInstagramScrapeJson: true,
      websiteScrapedAt: true,
      instagramScrapedAt: true,
      deterministicScore: true,
      scoreBand: true,
      discoveryRunId: true,
      preQualified: true,
    },
  });

  if (!business) {
    logger.warn(logCtx, 'Business not found — skipping conversion');
    await prisma.business.update({
      where: { id: businessId },
      data: { preQualified: false, disqualificationReason: 'BUSINESS_NOT_FOUND' },
    }).catch(() => { /* Business truly doesn't exist — nothing to update */ });
    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
    return;
  }

  // ── 2. Require websiteDomain ──────────────────────────────────────────
  if (!business.websiteDomain) {
    logger.warn(
      { ...logCtx, reason: 'NO_DOMAIN' },
      'Business has no website domain — cannot find contacts, skipping',
    );
    await prisma.business.update({
      where: { id: businessId },
      data: { preQualified: false, disqualificationReason: 'NO_WEBSITE_DOMAIN' },
    });
    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
    return;
  }

  const domain = business.websiteDomain;

  // ── 2b. Cross-run domain dedup (F4) ───────────────────────────────────
  // If this business's domain was already processed in a PREVIOUS discovery
  // run AND that run created a lead (converted or rejected), skip entirely.
  // Only dedup across DIFFERENT runs, not within the same run.
  const priorDomainLead = await prisma.lead.findFirst({
    where: {
      business: {
        websiteDomain: domain,
        discoveryRunId: { not: discoveryRunId },
      },
      deletedAt: null,
    },
    select: { id: true, status: true },
  });
  if (priorDomainLead) {
    logger.info(
      {
        ...logCtx,
        domain,
        priorLeadId: priorDomainLead.id,
        priorLeadStatus: priorDomainLead.status,
      },
      'Cross-run domain dedup — domain already has a lead from a previous run, skipping',
    );
    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
    return;
  }

  if (!deps) {
    logger.warn(logCtx, 'No dependencies provided — cannot convert business');
    return;
  }

  // ── 3. Website scrape FIRST (highest ROI — free, extracts contacts) ───
  let websiteScrapeData: WebsiteScraperResult['data'] = undefined;
  let discoveredInstagramHandle: string | null = null;

  if (
    includeWebsiteAnalysis !== false &&
    deps.websiteScraperAdapter?.isConfigured
  ) {
    if (isCacheValid(business.websiteScrapedAt)) {
      logger.info(
        { ...logCtx, websiteScrapedAt: business.websiteScrapedAt },
        'Skipping website scrape — cache still valid',
      );
      // Use cached data for contact extraction
      if (business.apifyWebsiteScrapeJson) {
        websiteScrapeData = business.apifyWebsiteScrapeJson as unknown as typeof websiteScrapeData;
      }
      // Extract Instagram handle from cache
      if (!business.instagramHandle && business.apifyWebsiteScrapeJson) {
        const cached = business.apifyWebsiteScrapeJson as Record<string, unknown>;
        const socialLinks = Array.isArray(cached.socialLinks)
          ? (cached.socialLinks as Array<Record<string, unknown>>)
          : [];
        const igLink = socialLinks.find((s) => s.platform === 'instagram');
        if (igLink && typeof igLink.handle === 'string' && igLink.handle.length > 0) {
          discoveredInstagramHandle = igLink.handle;
        }
      }
    } else {
      const websiteResult = await deps.websiteScraperAdapter.scrapeWebsite(domain);

      if (websiteResult.status === 'success' && websiteResult.data) {
        websiteScrapeData = websiteResult.data;
        const updateData: Record<string, unknown> = {
          apifyWebsiteScrapeJson: toInputJson(websiteResult.data),
          websiteScrapedAt: new Date(),
        };

        // Discover Instagram handle from social links
        if (!business.instagramHandle && websiteResult.data.socialLinks) {
          const igLink = websiteResult.data.socialLinks.find(
            (s) => s.platform === 'instagram',
          );
          if (igLink?.handle) {
            discoveredInstagramHandle = igLink.handle;
            updateData.instagramHandle = igLink.handle;
            logger.info(
              { ...logCtx, discoveredInstagramHandle: igLink.handle },
              'Discovered Instagram handle from website social links',
            );
          }
        }

        await prisma.business.update({
          where: { id: businessId },
          data: updateData as Prisma.BusinessUpdateInput,
        });

        logger.info(
          { ...logCtx, pagesCrawled: websiteResult.data.pagesCrawled, crawlDurationMs: websiteResult.data.crawlDurationMs },
          'Website scrape completed and cached',
        );
      } else {
        logger.warn(
          { ...logCtx, websiteScrapeStatus: websiteResult.status },
          'Website scrape failed — continuing without website data',
        );
      }
    }
  }

  // ── 4. Instagram scrape (may have business email) ──────────────────────
  let instagramData: InstagramScraperResult['data'] = undefined;
  const instagramHandle = business.instagramHandle ?? discoveredInstagramHandle;
  if (
    includeSocialMediaAnalysis !== false &&
    deps.instagramScraperAdapter?.isConfigured &&
    instagramHandle
  ) {
    if (isCacheValid(business.instagramScrapedAt)) {
      logger.info(
        { ...logCtx, instagramScrapedAt: business.instagramScrapedAt },
        'Skipping Instagram scrape — cache still valid',
      );
      if (business.apifyInstagramScrapeJson) {
        instagramData = business.apifyInstagramScrapeJson as unknown as typeof instagramData;
      }
    } else {
      const igResult = await deps.instagramScraperAdapter.scrapeProfile(
        instagramHandle,
      );

      if (igResult.status === 'success' && igResult.data) {
        instagramData = igResult.data;
        await prisma.business.update({
          where: { id: businessId },
          data: {
            apifyInstagramScrapeJson: toInputJson(igResult.data),
            instagramScrapedAt: new Date(),
          },
        });

        logger.info(
          { ...logCtx, instagramHandle, authenticated: Boolean(igResult.data.isVerified !== undefined) },
          'Instagram scrape completed and cached',
        );
      } else {
        logger.warn(
          { ...logCtx, instagramScrapeStatus: igResult.status, instagramHandle },
          'Instagram scrape failed — continuing without Instagram data',
        );
      }
    }
  }

  // ── 4b. Generate AI business insights from scrape data ───────────────
  let businessInsights: string | null = null;

  if (deps.openAiAdapter?.isConfigured && (websiteScrapeData || instagramData)) {
    const insightParts: string[] = [];
    insightParts.push(`Business: ${business.name}`);
    if (domain) insightParts.push(`Domain: ${domain}`);
    if (business.category) insightParts.push(`Category: ${business.category}`);
    if (business.city) insightParts.push(`City: ${business.city}`);
    if (business.countryCode) insightParts.push(`Country: ${business.countryCode}`);

    if (websiteScrapeData) {
      if (websiteScrapeData.hasShopify) insightParts.push('Uses Shopify');
      if (websiteScrapeData.hasWhatsApp) insightParts.push('Has WhatsApp on site');
      if (websiteScrapeData.hasPricingTiers) insightParts.push('Has tiered pricing');
      if (websiteScrapeData.hasProductCatalog) insightParts.push('Has product catalog');
      if (websiteScrapeData.detectedPlatforms.length > 0) insightParts.push(`Platforms: ${websiteScrapeData.detectedPlatforms.join(', ')}`);
      if (websiteScrapeData.paymentWidgets.length > 0) insightParts.push(`Payment widgets: ${websiteScrapeData.paymentWidgets.join(', ')}`);
      if (websiteScrapeData.technologies) {
        const tech = websiteScrapeData.technologies;
        const techParts: string[] = [];
        if (tech.crm.length > 0) techParts.push(`CRM: ${tech.crm.join(', ')}`);
        if (tech.liveChat.length > 0) techParts.push(`Live chat: ${tech.liveChat.join(', ')}`);
        if (tech.analytics.length > 0) techParts.push(`Analytics: ${tech.analytics.join(', ')}`);
        if (tech.ecommerce.length > 0) techParts.push(`Ecommerce: ${tech.ecommerce.join(', ')}`);
        if (techParts.length > 0) insightParts.push(`Tech: ${techParts.join('; ')}`);
      }
      if (websiteScrapeData.businessSignals.estimatedEmployeeCount) {
        insightParts.push(`~${websiteScrapeData.businessSignals.estimatedEmployeeCount} employees`);
      }
      if (websiteScrapeData.decisionMakers.length > 0) {
        const topDMs = websiteScrapeData.decisionMakers.slice(0, 3).map(dm => `${dm.name} (${dm.title ?? dm.seniority})`);
        insightParts.push(`Key people: ${topDMs.join(', ')}`);
      }
    }

    if (instagramData) {
      const igParts: string[] = [];
      if (instagramData.followerCount > 0) igParts.push(`${instagramData.followerCount} followers`);
      if (instagramData.businessCategory) igParts.push(`Category: ${instagramData.businessCategory}`);
      if (instagramData.bio) igParts.push(`Bio: ${instagramData.bio}`);
      if (instagramData.engagementRate !== null) igParts.push(`Engagement: ${(instagramData.engagementRate * 100).toFixed(1)}%`);
      if (igParts.length > 0) insightParts.push(`Instagram: ${igParts.join(', ')}`);

      // Include recent post topics for context
      if (instagramData.recentPosts && instagramData.recentPosts.length > 0) {
        const postSummaries = instagramData.recentPosts
          .filter(p => p.caption.length > 0)
          .slice(0, 3)
          .map(p => `"${p.caption.slice(0, 100)}..." (${p.likeCount} likes)`);
        if (postSummaries.length > 0) {
          insightParts.push(`Recent posts: ${postSummaries.join('; ')}`);
        }
      }
    }

    const businessDataStr = insightParts.join('\n');

    try {
      const insightResult = await deps.openAiAdapter.generateBusinessInsights(businessDataStr);
      if (insightResult.status === 'success') {
        businessInsights = insightResult.data;
        logger.info(
          { ...logCtx, insightsLength: businessInsights.length },
          'Generated AI business insights',
        );
      } else {
        logger.warn(
          { ...logCtx, insightStatus: insightResult.status },
          'AI insight generation failed — proceeding without insights',
        );
      }
    } catch {
      logger.warn(logCtx, 'AI insight generation threw — proceeding without insights');
    }
  }

  // ── 4c. Apollo pre-screen (FREE — zero credits) ─────────────────────────
  let apolloHasEmail = false;
  let apolloHasDirectPhone = false;

  if (deps.apolloAdapter.isConfigured && deps.apolloAdapter.preScreenDomain) {
    const preScreenResult = await deps.apolloAdapter.preScreenDomain(domain);
    if (preScreenResult.status === 'success') {
      apolloHasEmail = preScreenResult.hasEmail;
      apolloHasDirectPhone = preScreenResult.hasDirectPhone;
      logger.info(
        { ...logCtx, apolloHasEmail, apolloHasDirectPhone, topContactTitle: preScreenResult.topContactTitle },
        'Apollo pre-screen completed (free)',
      );
    } else {
      logger.warn(
        { ...logCtx, apolloPreScreenStatus: preScreenResult.status },
        'Apollo pre-screen failed — continuing without pre-screen data',
      );
    }
  }

  // ── 5. Collect ALL contacts as BusinessContact candidates ──────────────
  interface ContactCandidate {
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    seniority: 'executive' | 'director' | 'manager' | 'other';
    positionRank: number;
    source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo';
    matchedRoleKeyword?: ContactDiscoveryRoleKeyword | null | undefined;
    matchedSignals?: string[] | undefined;
    confidence?: number | undefined;
    verificationVerdict?: ContactVerificationVerdict | undefined;
    supportingUrls?: string[] | undefined;
    rawJson: unknown;
  }

  const allCandidates: ContactCandidate[] = [];
  // Gate pass-rate tracking — logged at end of job for pipeline diagnostics
  const gateStats = {
    websiteDMs: 0,
    websiteEmailsKept: 0,
    instagramEmailFound: false,
    emailMatchAttempts: 0,
    emailMatchHigh: 0,
    hunterTotal: 0,
    hunterGenericDrop: 0,
    hunterInvalidDrop: 0,
    hunterLowConfDrop: 0,
    hunterSmtpDrop: 0,
    hunterPass: 0,
    apolloTotal: 0,
    apolloGenericDrop: 0,
    apolloSmtpDrop: 0,
    apolloPass: 0,
    llmExtracted: 0,
    llmFakeNames: 0,
    nameValChecked: 0,
    nameValRejected: 0,
    paidGateBlocked: false,
    paidGateReason: null as string | null,
    identityConfidence: 0,
    contactConfidence: 0,
    totalCandidates: 0,
    withEmail: 0,
    outcome: 'pending' as string,
  };
  let apolloContactJson: unknown = null;
  let hunterContactJson: unknown = null;
  const costEvents: Array<{ provider: 'APOLLO' | 'HUNTER' | 'GOOGLE_CUSTOM_SEARCH'; costCents: number; apiCallType: string }> = [];
  const recoveryAttempts: ContactRecoveryAttempt[] = [];
  const recoveryTelemetry: ContactRecoveryTelemetryState = {
    cseVerifyAttempted: false,
    cseVerifySucceeded: false,
    cseDiscoverAttempted: false,
    cseDiscoverSucceeded: false,
    cseRawResults: 0,
    cseValidProfiles: 0,
    cseCandidatesAdded: 0,
    cseCandidatesValidated: 0,
    cseEmailsInferred: 0,
    topSourceFamily: 'unknown',
    finalOutcome: 'no_contact_terminal',
    verificationVerdict: 'skipped',
    supportingUrls: [],
    diagnostics: [],
    topQueryFamily: null,
  };
  const estimatedEmployees = websiteScrapeData?.businessSignals?.estimatedEmployeeCount ?? null;

  // 5a. Website scrape decision makers (max 5, already ranked by positionRank)
  if (websiteScrapeData?.decisionMakers && websiteScrapeData.decisionMakers.length > 0) {
    gateStats.websiteDMs = websiteScrapeData.decisionMakers.length;
    for (const dm of websiteScrapeData.decisionMakers) {
      // Filter generic emails
      const email = dm.email && !isGenericEmail(dm.email) && !isJunkPersonalEmail(dm.email) ? dm.email : null;
      if (email) gateStats.websiteEmailsKept++;
      // Filter generic phones using context-aware heuristic
      const phone = dm.phone && !isGenericPhone(dm.phone, true, estimatedEmployees, dm.source)
        ? dm.phone : null;
      const { firstName, lastName } = parseName(dm.name);
      allCandidates.push({
        name: dm.name,
        title: dm.title,
        email,
        phone,
        linkedinUrl: dm.linkedinUrl,
        seniority: dm.seniority,
        positionRank: dm.positionRank,
        source: 'website_scrape',
        rawJson: dm,
      });
      // SMTP verify the email eagerly for the first valid candidate
      if (email && deps.smtpVerifier?.isConfigured) {
        const verification = await deps.smtpVerifier.verify(email);
        if (verification.status !== 'valid' && verification.status !== 'catch_all') {
          // Mark email as invalid — null it out so it won't be selected as lead
          allCandidates[allCandidates.length - 1]!.email = null;
          logger.info(
            { ...logCtx, email, smtpStatus: verification.status, name: `${firstName} ${lastName}` },
            'Decision maker email failed SMTP verification',
          );
        }
      }
    }
  }

  // 5b. Instagram business email as a contact
  if (instagramData?.businessEmail && !isJunkPersonalEmail(instagramData.businessEmail)) {
    gateStats.instagramEmailFound = true;
    let igEmailValid = true;
    if (deps.smtpVerifier?.isConfigured) {
      const verification = await deps.smtpVerifier.verify(instagramData.businessEmail);
      if (verification.status !== 'valid' && verification.status !== 'catch_all') {
        igEmailValid = false;
      }
    }
    allCandidates.push({
      name: 'Unknown Contact',
      title: null,
      email: igEmailValid ? instagramData.businessEmail : null,
      phone: null, // Instagram businessPhone is the company's phone, not a decision maker's personal phone
      linkedinUrl: null,
      seniority: 'other',
      positionRank: 99,
      source: 'instagram',
      rawJson: instagramData,
    });
  }

  // 5c. Match scraped emails to decision makers (free, high value)
  if (websiteScrapeData?.contactInfo?.emails && websiteScrapeData.decisionMakers.length > 0) {
    const assignedEmails = new Set(allCandidates.filter((c) => c.email).map((c) => c.email!.toLowerCase()));
    const dms = websiteScrapeData.decisionMakers.map((dm) => ({
      name: dm.name,
      title: dm.title,
      seniority: dm.seniority,
    }));

    for (const { email: rawEmail } of websiteScrapeData.contactInfo.emails) {
      if (isGenericEmail(rawEmail) || isJunkPersonalEmail(rawEmail)) continue;
      if (assignedEmails.has(rawEmail.toLowerCase())) continue;

      gateStats.emailMatchAttempts++;
      const match = matchEmailToDecisionMaker(rawEmail, dms);
      if (match && match.confidence === 'HIGH') {
        gateStats.emailMatchHigh++;
        // SMTP verify before adding
        let verified = true;
        if (deps.smtpVerifier?.isConfigured) {
          const smtpResult = await deps.smtpVerifier.verify(rawEmail);
          if (smtpResult.status !== 'valid' && smtpResult.status !== 'catch_all') {
            verified = false;
          }
        }
        if (verified) {
          const { firstName, lastName } = parseName(match.matchedDm.name);
          allCandidates.push({
            name: match.matchedDm.name,
            title: match.matchedDm.title,
            email: rawEmail,
            phone: null,
            linkedinUrl: null,
            seniority: match.matchedDm.seniority as ContactCandidate['seniority'],
            positionRank: 10, // High priority — DM-matched email
            source: 'website_scrape',
            rawJson: { matchType: 'email_to_dm', confidence: match.confidence },
          });
          assignedEmails.add(rawEmail.toLowerCase());
          logger.info(
            { ...logCtx, email: rawEmail, matchedDm: `${firstName} ${lastName}` },
            'Matched scraped email to decision maker (HIGH confidence)',
          );
        }
      }
    }
  }

  let hunterRetryable = false;
  let apolloRetryable = false;
  let isDraftedLead = false;
  let emailInferenceAttempted = 0;
  let emailInferenceFailedVerification = 0;
  let adjudication: CandidateAdjudicationResult | null = null;
  let winnerSelectionMethod: 'deterministic' | 'llm' = 'deterministic';
  const locality = [business.city, business.countryCode].filter(Boolean).join(', ') || null;
  const isHighValueBusiness = business.scoreBand === 'HIGH' || business.deterministicScore >= 0.75;

  // 5d. Email pattern inference from known emails (free, eliminates ~20-30% of Hunter calls)
  if (websiteScrapeData?.decisionMakers && websiteScrapeData.decisionMakers.length > 0) {
    const hasValidEmailFromScrape = allCandidates.some((c) => c.email !== null);
    if (!hasValidEmailFromScrape) {
      // Gather known email/name pairs for pattern detection
      const knownEmails = allCandidates
        .filter((c) => c.email !== null)
        .map((c) => {
          const { firstName, lastName } = parseName(c.name);
          return { email: c.email!, firstName, lastName };
        });

      // Also include scraped emails matched to names from the page
      if (websiteScrapeData.contactInfo?.emails) {
        for (const { email: rawEmail } of websiteScrapeData.contactInfo.emails) {
          if (isGenericEmail(rawEmail) || isJunkPersonalEmail(rawEmail)) continue;
          const dms = websiteScrapeData.decisionMakers.map((dm) => ({
            name: dm.name,
            title: dm.title,
            seniority: dm.seniority,
          }));
          const match = matchEmailToDecisionMaker(rawEmail, dms);
          if (match) {
            const { firstName, lastName } = parseName(match.matchedDm.name);
            knownEmails.push({ email: rawEmail, firstName, lastName });
          }
        }
      }

      const dmsForInference = websiteScrapeData.decisionMakers.map((dm) => ({
        name: dm.name,
        title: dm.title,
        seniority: dm.seniority,
      }));

      const inferenceResult = await inferEmailPattern(
        knownEmails,
        domain,
        dmsForInference,
        deps.smtpVerifier?.isConfigured ? deps.smtpVerifier : undefined,
      );
      emailInferenceAttempted += inferenceResult.attempted;
      emailInferenceFailedVerification += inferenceResult.failedVerification;

      for (const { email: inferredEmail, dm, pattern } of inferenceResult.matches) {
        allCandidates.push({
          name: dm.name,
          title: dm.title,
          email: inferredEmail,
          phone: null,
          linkedinUrl: null,
          seniority: dm.seniority as ContactCandidate['seniority'],
          positionRank: 15, // High priority — pattern-inferred + SMTP verified
          source: 'website_scrape',
          rawJson: { matchType: 'pattern_inference', pattern },
        });
        logger.info(
          { ...logCtx, email: inferredEmail, pattern, dm: dm.name },
          'Inferred email via pattern detection + SMTP verified',
        );
      }
    }
  }

  // 5e. Fallback to paid providers if no candidate has a valid email yet
  const hasValidEmail = allCandidates.some((candidate) =>
    candidate.email !== null && !isGenericEmail(candidate.email) && !isJunkPersonalEmail(candidate.email),
  );
  let identityConfidence = scoreIdentityConfidence({
    candidates: allCandidates,
    businessName: business.name,
  });
  const hasCredibleNamedCandidate = allCandidates.some((candidate) =>
    isCredibleNamedCandidate(candidate, business.name),
  );
  const identityThreshold = isHighValueBusiness ? 0.48 : 0.58;
  // Hunter searches by domain — only needs prequalified + no valid email
  const shouldSkipHunter = business.preQualified === false || hasValidEmail;
  // Apollo/expensive enrichment — needs identity confidence (more targeted)
  const shouldStopPaidEnrichment = business.preQualified === false
    || !hasCredibleNamedCandidate
    || identityConfidence < identityThreshold
    || hasValidEmail;

  if (!shouldSkipHunter && !hasValidEmail) {
    logger.info(
      { ...logCtx, identityConfidence, identityThreshold, hasCredibleNamedCandidate },
      'No valid email from free sources — Hunter gate passed',
    );

    // Hunter (cheaper) — check budget ceiling first
    const hunterWithinBudget = await isProviderWithinBudget('HUNTER');
    const hunterBusinessBudget = await canSpendOnProviderForBusiness({
      provider: 'HUNTER',
      apiCallType: 'domain_search',
      businessId,
      isHighValueBusiness,
    });
    if (!hunterWithinBudget) {
      logger.warn(logCtx, 'Hunter daily budget ceiling exceeded — skipping paid lookup');
    }
    if (!hunterBusinessBudget) {
      logger.info(logCtx, 'Per-business Hunter budget reached — skipping paid lookup');
    }
    if (deps.hunterAdapter.isConfigured && hunterWithinBudget && hunterBusinessBudget) {
      const hunterResult = await deps.hunterAdapter.searchDomainContacts(domain);
      if (hunterResult.status === 'success' && hunterResult.contacts.length > 0) {
        hunterContactJson = hunterResult.contacts;
        for (const hc of hunterResult.contacts) {
          gateStats.hunterTotal++;
          if (isGenericEmail(hc.email) || isJunkPersonalEmail(hc.email)) {
            gateStats.hunterGenericDrop++;
            continue;
          }

          // Skip emails Hunter marks as invalid
          if (hc.verification === 'invalid') {
            gateStats.hunterInvalidDrop++;
            logger.info(
              { ...logCtx, email: hc.email, hunterVerification: hc.verification },
              'Skipping Hunter contact — marked invalid by Hunter',
            );
            continue;
          }

          // Skip low-confidence emails (likely pattern-guessed, unverified)
          if (hc.confidence !== null && hc.confidence < 55) {
            gateStats.hunterLowConfDrop++;
            logger.info(
              { ...logCtx, email: hc.email, hunterConfidence: hc.confidence },
              'Skipping Hunter contact — confidence below 55',
            );
            continue;
          }

          // Trust Hunter's own verification — only SMTP-verify if Hunter didn't verify
          if (hc.verification !== 'valid' && deps.smtpVerifier?.isConfigured) {
            const smtpResult = await deps.smtpVerifier.verify(hc.email);
            if (smtpResult.status !== 'valid' && smtpResult.status !== 'catch_all') {
              gateStats.hunterSmtpDrop++;
              logger.info(
                { ...logCtx, email: hc.email, smtpStatus: smtpResult.status, hunterVerification: hc.verification },
                'Hunter contact failed SMTP verification',
              );
              continue;
            }
          }

          gateStats.hunterPass++;
          allCandidates.push({
            name: [hc.firstName ?? '', hc.lastName ?? ''].filter(Boolean).join(' ') || 'Unknown Contact',
            title: hc.position,
            email: hc.email,
            phone: null,
            linkedinUrl: null,
            seniority: hc.position ? classifySeniorityLocal(hc.position) : 'other',
            positionRank: 50,
            source: 'hunter',
            rawJson: hc,
          });
        }
      } else if (hunterResult.status === 'retryable_error') {
        hunterRetryable = true;
      }
      if (hunterResult.status === 'success') {
        // Hunter Domain Search: $49/mo starter plan = 500 searches = ~$0.10/search = 10 cents.
        // However, Hunter also has "one search = one request" model: $15/500 on Starter = ~3 cents.
        // Using 3 cents: based on Hunter Starter plan ($49/mo for 500 email finder + domain search).
        costEvents.push({ provider: 'HUNTER', costCents: 3, apiCallType: 'domain_search' });
      }
      logger.info(
        { ...logCtx, hunterStatus: hunterResult.status, contactsFound: hunterResult.status === 'success' ? hunterResult.contacts.length : 0 },
        'Hunter domain search completed (fallback)',
      );
      recoveryAttempts.push({
        stage: 'contact_recovery',
        provider: 'HUNTER',
        mode: 'discover',
        status: hunterResult.status,
        resultCount: hunterResult.status === 'success' ? hunterResult.contacts.length : 0,
        notes: [],
      });
    }

  }

  // Apollo (more expensive — needs identity confidence + budget)
  if (!shouldStopPaidEnrichment && !hasValidEmail) {
    const hasEmailAfterHunter = allCandidates.some((c) => c.email !== null);
    const apolloWithinBudget = await isProviderWithinBudget('APOLLO');
    const apolloBusinessBudget = await canSpendOnProviderForBusiness({
      provider: 'APOLLO',
      apiCallType: 'contact_search',
      businessId,
      isHighValueBusiness,
    });
    if (!hasEmailAfterHunter && !apolloWithinBudget) {
      logger.warn(logCtx, 'Apollo daily budget ceiling exceeded — skipping paid lookup');
    }
    if (!hasEmailAfterHunter && !apolloBusinessBudget) {
      logger.info(logCtx, 'Per-business Apollo budget reached — skipping paid lookup');
    }
    if (!hasEmailAfterHunter && deps.apolloAdapter.isConfigured && apolloHasEmail && apolloWithinBudget && apolloBusinessBudget) {
      // ── F1: Pre-score gate — skip paid Apollo if deterministic pre-score is too low ──
      const preScoreFeatures = {
        reviewCount: business.reviewCount ?? 0,
        hasWhatsapp: Boolean(websiteScrapeData?.hasWhatsApp),
        hasInstagram: Boolean(instagramHandle),
        followerCount: instagramData?.followerCount ?? 0,
        physicalAddressPresent: Boolean(business.address && business.address.length > 0),
        recentActivity: Boolean(instagramData?.lastPostDate),
        techStackSize: websiteScrapeData?.technologies
          ? Object.values(websiteScrapeData.technologies).reduce((sum, arr) => sum + arr.length, 0)
          : 0,
        hasBookingForm: Boolean(websiteScrapeData?.hasBookingForm),
        acceptsOnlinePayments: Boolean(
          websiteScrapeData?.paymentWidgets && websiteScrapeData.paymentWidgets.length > 0,
        ),
      };
      // Quick deterministic pre-score using only pre-enrichment signals
      let deterministicPreScore = 0;
      if (preScoreFeatures.reviewCount >= 50) deterministicPreScore += 0.15;
      else if (preScoreFeatures.reviewCount >= 15) deterministicPreScore += 0.08;
      if (preScoreFeatures.hasWhatsapp) deterministicPreScore += 0.12;
      if (preScoreFeatures.hasInstagram) deterministicPreScore += 0.05;
      if (preScoreFeatures.followerCount >= 1000) deterministicPreScore += 0.10;
      else if (preScoreFeatures.followerCount >= 200) deterministicPreScore += 0.05;
      if (preScoreFeatures.physicalAddressPresent) deterministicPreScore += 0.08;
      if (preScoreFeatures.recentActivity) deterministicPreScore += 0.08;
      if (preScoreFeatures.techStackSize >= 3) deterministicPreScore += 0.10;
      else if (preScoreFeatures.techStackSize >= 1) deterministicPreScore += 0.05;
      if (preScoreFeatures.hasBookingForm) deterministicPreScore += 0.10;
      if (preScoreFeatures.acceptsOnlinePayments) deterministicPreScore += 0.12;
      // Base score — every business gets some credit for existing in Maps
      deterministicPreScore += 0.10;

      const preScoreThreshold = await getScoreQualificationThreshold(); // default 0.40
      if (deterministicPreScore < preScoreThreshold) {
        logger.info(
          {
            ...logCtx,
            deterministicPreScore: Number(deterministicPreScore.toFixed(3)),
            preScoreThreshold,
            preScoreFeatures,
          },
          'Pre-score below qualification threshold — skipping paid Apollo contact search',
        );
        gateStats.paidGateBlocked = true;
        gateStats.paidGateReason = 'pre_score_below_threshold';
      } else {
        // ── F2: Cross-run Apollo cache — reuse prior results for same domain ──
        let apolloCacheHit = false;
        const cachedConversion = await prisma.businessConversion.findFirst({
          where: {
            business: {
              websiteDomain: domain,
              id: { not: businessId }, // different business, same domain
            },
            apolloContactJson: { not: PrismaRuntime.JsonNull },
          },
          select: { apolloContactJson: true },
          orderBy: { createdAt: 'desc' },
        });

        let apolloResult: ApolloContactSearchResult;
        if (cachedConversion?.apolloContactJson) {
          // Reuse cached Apollo contacts from a prior run
          const cached = cachedConversion.apolloContactJson as unknown as ApolloContact[];
          apolloResult = { status: 'success' as const, contacts: Array.isArray(cached) ? cached : [] };
          apolloCacheHit = true;
          logger.info(
            { ...logCtx, domain, cachedContactCount: apolloResult.contacts.length },
            'Apollo contact cache hit — reusing prior run data for same domain',
          );
        } else {
          apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);
        }

        if (apolloResult.status === 'success' && apolloResult.contacts.length > 0) {
          for (const ac of apolloResult.contacts) {
            gateStats.apolloTotal++;
            if (isGenericEmail(ac.email) || isJunkPersonalEmail(ac.email)) {
              gateStats.apolloGenericDrop++;
              continue;
            }

            // SMTP verify Apollo email if verifier is available
            if (deps.smtpVerifier?.isConfigured) {
              const smtpResult = await deps.smtpVerifier.verify(ac.email);
              if (smtpResult.status !== 'valid' && smtpResult.status !== 'catch_all') {
                gateStats.apolloSmtpDrop++;
                logger.info(
                  { ...logCtx, email: ac.email, smtpStatus: smtpResult.status },
                  'Apollo contact failed SMTP verification',
                );
                continue;
              }
            }

            gateStats.apolloPass++;
            apolloContactJson = ac;
            allCandidates.push({
              name: [ac.firstName, ac.lastName].filter(Boolean).join(' ') || 'Unknown Contact',
              title: ac.title,
              email: ac.email,
              phone: ac.phone,
              linkedinUrl: null,
              seniority: ac.title ? classifySeniorityLocal(ac.title) : 'other',
              positionRank: 50,
              source: 'apollo',
              rawJson: ac,
            });
          }
        } else if (apolloResult.status === 'retryable_error') {
          apolloRetryable = true;
        }
        if (apolloResult.status === 'success' && !apolloCacheHit) {
          // Only charge cost for actual API calls, not cache hits
          // Apollo People Search: Free plan = 5 mobile + 10 export credits/mo.
          // Basic plan ($49/mo) = 900 credits. ~$0.05/credit, but domain search uses 1 credit.
          // Effective cost ~2 cents/call on volume. Using 2 cents as conservative estimate.
          costEvents.push({ provider: 'APOLLO', costCents: 2, apiCallType: 'contact_search' });
        }
        logger.info(
          {
            ...logCtx,
            apolloStatus: apolloResult.status,
            apolloCacheHit,
            contactsFound: apolloResult.status === 'success' ? apolloResult.contacts.length : 0,
          },
          apolloCacheHit ? 'Apollo contact search completed (cache hit)' : 'Apollo contact search completed (fallback)',
        );
        recoveryAttempts.push({
          stage: 'contact_recovery',
          provider: 'APOLLO',
          mode: 'discover',
          status: apolloResult.status,
          resultCount: apolloResult.status === 'success' ? apolloResult.contacts.length : 0,
          notes: apolloCacheHit ? ['reused cached Apollo contacts for same domain'] : [],
        });
      }
    }
  } else if (!hasValidEmail && !shouldSkipHunter) {
    // Apollo gate blocked but Hunter already ran above
    gateStats.paidGateBlocked = true;
    gateStats.paidGateReason = !hasCredibleNamedCandidate
      ? 'no_credible_named_candidate'
      : identityConfidence < identityThreshold
        ? 'identity_confidence_below_threshold'
        : 'validated_personal_email_already_present';
    logger.info(
      {
        ...logCtx,
        identityConfidence,
        identityThreshold,
        paidGateReason: gateStats.paidGateReason,
        hasCredibleNamedCandidate,
      },
      'Skipping Apollo enrichment due to identity confidence gate (Hunter ran independently)',
    );
  } else if (!hasValidEmail) {
    gateStats.paidGateBlocked = true;
    gateStats.paidGateReason = business.preQualified === false
      ? 'business_not_prequalified'
      : 'validated_personal_email_already_present';
    logger.info(
      { ...logCtx, paidGateReason: gateStats.paidGateReason },
      'Skipping paid enrichment — business not prequalified',
    );
  } else {
    logger.info(
      { ...logCtx, candidateCount: allCandidates.length },
      'Valid email found from scrape data — skipping paid providers',
    );
  }

  // ── 5f. LLM extraction fallback — when rule-based extraction found zero valid team members (B9)
  if (deps.llmExtractionConfig?.openAiApiKey && websiteScrapeData) {
    const validScrapeCandidates = allCandidates.filter(
      (c) => c.source === 'website_scrape' && isValidPersonName(c.name, business.name),
    );

    if (validScrapeCandidates.length === 0) {
      // Prefer raw about/team page text for richer LLM context, fall back to DM summary
      const aboutText = websiteScrapeData.aboutPageText ?? '';
      const pageText = aboutText.length > 50
        ? aboutText
        : [
            websiteScrapeData.decisionMakers?.map((dm) => `${dm.name} - ${dm.title ?? ''}`).join('\n') ?? '',
            websiteScrapeData.contactInfo?.emails?.map((e) => e.email).join(', ') ?? '',
          ].join('\n');

      if (pageText.trim().length > 10) {
        const llmContacts = await extractDecisionMakers(
          pageText,
          business.name,
          deps.llmExtractionConfig,
        );

        for (const llmC of llmContacts) {
          const llmEmail = llmC.email && !isGenericEmail(llmC.email) && !isJunkPersonalEmail(llmC.email) ? llmC.email : null;
          allCandidates.push({
            name: llmC.name,
            title: llmC.title,
            email: llmEmail,
            phone: llmC.phone,
            linkedinUrl: null,
            seniority: llmC.title ? classifySeniorityLocal(llmC.title) : 'other',
            positionRank: 30,
            source: 'website_scrape',
            rawJson: { matchType: 'llm_extraction' },
          });
        }

        gateStats.llmExtracted = llmContacts.length;
        if (llmContacts.length > 0) {
          logger.info(
            { ...logCtx, llmContactsFound: llmContacts.length },
            'LLM extracted decision makers as fallback',
          );
        }
      }
    }
  }

  // ── 5g. Rule-based name validation — apply to ALL remaining candidates (B2)
  // Exempt Instagram-sourced contacts with emails — they're worth keeping
  // even with "Unknown Contact" name, routed to Business Intel as drafted leads
  gateStats.nameValChecked = allCandidates.length;
  for (let i = allCandidates.length - 1; i >= 0; i--) {
    const candidate = allCandidates[i]!;
    if (candidate.source === 'instagram' && candidate.email) continue;
    if (!isValidPersonName(candidate.name, business.name)) {
      gateStats.nameValRejected++;
      logger.info(
        { ...logCtx, invalidName: candidate.name, source: candidate.source },
        'Contact rejected by name validation',
      );
      allCandidates.splice(i, 1);
    }
  }

  // Calculate confidence for all candidates before ranking.
  for (const candidate of allCandidates) {
    if (candidate.confidence === undefined) {
      candidate.confidence = scoreCandidateConfidence({
        source: candidate.source,
        hasEmail: candidate.email !== null,
        hasLinkedin: candidate.linkedinUrl !== null,
        seniority: candidate.seniority,
      });
    }
  }

  identityConfidence = scoreIdentityConfidence({
    candidates: allCandidates,
    businessName: business.name,
  });
  gateStats.identityConfidence = identityConfidence;

  const rankCandidates = (candidates: ContactCandidate[]): ContactCandidate[] => candidates.slice().sort((a, b) => {
    const tierDiff = getDecisionMakerTier(a.title) - getDecisionMakerTier(b.title);
    if (tierDiff !== 0) return tierDiff;
    const senDiff = seniorityRank(a.seniority) - seniorityRank(b.seniority);
    if (senDiff !== 0) return senDiff;
    const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confDiff !== 0) return confDiff;
    return a.positionRank - b.positionRank;
  });
  // ── 6. Select highest-authority contact as Lead (B3 — improved priority) ──
  // Sort: seniority (executive=0, director=1, manager=2, other=3), then confidence, then positionRank.
  let sortedCandidates = rankCandidates(allCandidates);

  if (
    deps.llmExtractionConfig?.openAiApiKey
    && sortedCandidates.length >= 2
  ) {
    const adjudicationCandidates = sortedCandidates
      .filter((candidate) => isValidPersonName(candidate.name, business.name))
      .slice(0, 5);

    // ── F3: Skip LLM adjudication when top candidate has high confidence ──
    const topCandidateConfidence = adjudicationCandidates[0]?.confidence ?? 0;
    if (topCandidateConfidence > 0.8) {
      logger.info(
        {
          ...logCtx,
          topCandidateConfidence,
          topCandidateName: adjudicationCandidates[0]?.name,
        },
        'Top candidate has high confidence (>0.8) — skipping LLM adjudication',
      );
    } else if (isAmbiguousTopCandidates(adjudicationCandidates)) {
      const inputCandidates = adjudicationCandidates.map((candidate, index) => ({
        id: `candidate-${index + 1}`,
        name: candidate.name,
        title: candidate.title,
        source: candidate.source,
        confidence: candidate.confidence ?? 0,
        matchedSignals: candidate.matchedSignals ?? [],
        supportingUrls: dedupeUrls(candidate.supportingUrls ?? []),
      }));
      adjudication = await adjudicateDecisionMakerCandidates(
        {
          businessName: business.name,
          locality,
          category: business.category,
          candidates: inputCandidates,
        },
        deps.llmExtractionConfig,
      );

      if (adjudication?.verdict === 'select_candidate' && adjudication.selectedCandidateId) {
        const selected = inputCandidates.find((candidate) => candidate.id === adjudication?.selectedCandidateId);
        if (selected) {
          const winner = allCandidates.find((candidate) => candidate.name === selected.name && candidate.title === selected.title);
          if (winner) {
            winner.confidence = Math.min(1, (winner.confidence ?? 0.5) + 0.12);
            winner.positionRank = Math.max(1, winner.positionRank - 5);
            winnerSelectionMethod = 'llm';
            sortedCandidates = rankCandidates(allCandidates);
          }
        }
      }
    }
  }

  // 6a. Try to infer email for high-authority candidates who lack one (B3)
  let inferredEmailCount = 0;
  for (const candidate of sortedCandidates) {
    if (candidate.email !== null) continue;
    if (seniorityRank(candidate.seniority) > 1) break; // Only for executives and directors

    // Gather known emails at this domain for pattern inference
    const knownEmails = allCandidates
      .filter((c) => c.email !== null && c.email.endsWith(`@${domain}`))
      .map((c) => {
        const { firstName, lastName } = parseName(c.name);
        return { email: c.email!, firstName, lastName };
      });

    if (knownEmails.length > 0) {
      const inferenceResult = await inferEmailPattern(
        knownEmails,
        domain,
        [{ name: candidate.name, title: candidate.title, seniority: candidate.seniority }],
        deps.smtpVerifier?.isConfigured ? deps.smtpVerifier : undefined,
      );
      emailInferenceAttempted += inferenceResult.attempted;
      emailInferenceFailedVerification += inferenceResult.failedVerification;

      if (inferenceResult.matches.length > 0) {
        if (isJunkPersonalEmail(inferenceResult.matches[0]!.email)) {
          continue;
        }
        candidate.email = inferenceResult.matches[0]!.email;
        inferredEmailCount += 1;
        logger.info(
          { ...logCtx, email: candidate.email, candidate: candidate.name, pattern: inferenceResult.matches[0]!.pattern },
          'Inferred email for high-authority candidate via pattern detection',
        );
      }
    }
  }

  recoveryAttempts.push({
    stage: 'contact_recovery',
    provider: 'EMAIL_PATTERN_INFERENCE',
    mode: 'discover',
    status: inferredEmailCount > 0 ? 'success' : 'empty',
    resultCount: inferredEmailCount,
    notes: inferredEmailCount > 0
      ? ['Recovered sendable email addresses from known company-domain patterns']
      : ['No company-domain email pattern could be inferred for top candidates'],
  });

  // 6b. Select the lead — prefer candidates with email, then by seniority
  const leadCandidates = sortedCandidates.filter((c) => c.email !== null);
  let resolvedContact = leadCandidates[0] ?? null;
  const cseTopCandidates: Array<Record<string, unknown>> = [];

  // If no candidate has an email but a high-authority person exists, prefer them
  if (!resolvedContact && sortedCandidates.length > 0) {
    const topCandidate = sortedCandidates[0]!;
    if (seniorityRank(topCandidate.seniority) <= 1) {
      resolvedContact = topCandidate;
    }
  }

  // 6c. Both paid providers retryable → throw to trigger pg-boss retry
  if (!resolvedContact && hunterRetryable && apolloRetryable) {
    throw new RetryableError(
      `Both Hunter and Apollo returned retryable errors for domain ${domain}`,
    );
  }

  // ── 6d. Determine phoneSource (B4) ────────────────────────────────────
  let phoneSource: string | null = null;
  if (resolvedContact?.phone) {
    switch (resolvedContact.source) {
      case 'website_scrape': phoneSource = 'WEBSITE_SCRAPE'; break;
      case 'hunter': phoneSource = 'HUNTER'; break;
      case 'apollo': phoneSource = 'APOLLO'; break;
      case 'instagram': phoneSource = 'INSTAGRAM'; break;
    }
  }

  // ── 6e. Separate generic vs personal email (B5) ────────────────────────
  let contactEmail: string | null = resolvedContact?.email ?? null;
  let businessEmailField: string | null = null;

  if (contactEmail && isJunkPersonalEmail(contactEmail)) {
    contactEmail = null;
  }

  if (contactEmail && isGenericEmail(contactEmail)) {
    // Generic email goes to businessEmail, not the primary email field
    businessEmailField = contactEmail;
    contactEmail = null;
  }

  // If no personal email, check all candidates for any generic email to store
  if (!businessEmailField) {
    const genericCandidate = allCandidates.find(
      (c) => c.email !== null && isGenericEmail(c.email),
    );
    if (genericCandidate) {
      businessEmailField = genericCandidate.email;
    }
  }

  // Also check scraped emails for generic ones to store
  if (!businessEmailField && websiteScrapeData?.contactInfo?.emails) {
    const genericScraped = websiteScrapeData.contactInfo.emails.find((e) =>
      isGenericEmail(e.email),
    );
    if (genericScraped) {
      businessEmailField = genericScraped.email;
    }
  }

  // ── 6f. Generic email handling: keep for manual review, never primary ────────
  if (!contactEmail && businessEmailField) {
    logger.info(
      { ...logCtx, genericEmail: businessEmailField },
      'Generic-only email found — preserving for manual review, not as primary lead contact',
    );
  }

  let terminalReason: ContactTerminalReason | null = null;
  const contactConfidence = scoreContactConfidence({
    hasValidatedPersonalEmail: contactEmail !== null && !isGenericEmail(contactEmail),
    hasGenericEmailFallback: businessEmailField !== null,
    selectedCandidate: resolvedContact
      ? {
          confidence: resolvedContact.confidence,
          seniority: resolvedContact.seniority,
          source: resolvedContact.source,
        }
      : null,
  });
  gateStats.contactConfidence = contactConfidence;

  // Populate gate stats before outcome decision
  gateStats.totalCandidates = allCandidates.length;
  gateStats.withEmail = allCandidates.filter((c) => c.email !== null).length;

  // ── 6g. No email at all → open recovery queue item ────────────────────
  if (!contactEmail) {
    const inconclusiveButPromising = hasCredibleNamedCandidate && identityConfidence >= identityThreshold;
    const recoveryReason = resolveRecoveryReasonWhenNoPersonalEmail({
      resolvedContact,
    });
    terminalReason = !resolvedContact
      ? 'no_named_candidate_found'
      : adjudication?.verdict === 'inconclusive'
        ? 'ambiguous_winner'
        : emailInferenceFailedVerification > 0 && emailInferenceAttempted > 0
          ? 'email_inferred_failed_verification'
          : 'named_candidate_no_email';
    if (inconclusiveButPromising) {
      isDraftedLead = true;
    }
    recoveryTelemetry.finalOutcome = 'recovery_opened';

    const recoverySnapshot = buildContactRecoverySnapshot({
      businessId,
      domain,
      locality,
      businessInsights,
      genericBusinessEmail: businessEmailField,
      telemetry: recoveryTelemetry,
      attempts: recoveryAttempts,
      topCandidates: sortedCandidates.slice(0, 5).map((candidate) =>
        toRecoveryCandidate({
          name: candidate.name,
          title: candidate.title,
          source: candidate.source,
          seniority: candidate.seniority,
          confidence: candidate.confidence,
          linkedinUrl: candidate.linkedinUrl,
          email: candidate.email,
          phone: candidate.phone,
          matchedSignals: candidate.matchedSignals,
          verificationVerdict: candidate.verificationVerdict,
          supportingUrls: candidate.supportingUrls,
      })),
      websiteIntelligence: websiteScrapeData ?? null,
      instagramIntelligence: instagramData ?? null,
      identityConfidence,
      contactConfidence,
      terminalReason: terminalReason ?? 'named_candidate_no_email',
      resolutionState: inconclusiveButPromising ? 'inconclusive_but_promising' : 'no_contact_terminal',
      adjudication,
    });

    await upsertContactRecoveryItem({
      businessId,
      icpProfileId,
      discoveryRunId,
      reason: recoveryReason,
      snapshot: recoverySnapshot,
    });

    // Persist discovered decision-makers even without a sendable email so
    // lead detail/business detail pages can render full team context.
    if (allCandidates.length > 0) {
      await prisma.businessContact.createMany({
        data: allCandidates.slice(0, 5).map((c) => ({
          businessId,
          name: c.name,
          title: c.title,
          email: c.email,
          phone: c.phone,
          linkedinUrl: c.linkedinUrl,
          seniority: c.seniority,
          positionRank: c.positionRank,
          source: c.source,
        })),
        skipDuplicates: true,
      });
    }

    gateStats.outcome = 'recovery';
    logger.warn(
      {
        ...logCtx,
        reason: recoveryReason,
        terminalReason,
        candidateCount: allCandidates.length,
        identityConfidence,
        contactConfidence,
        gateStats,
      },
      'No email found at all — opened contact recovery item',
    );
    await prisma.business.update({
      where: { id: businessId },
      data: inconclusiveButPromising
        ? { preQualified: true, disqualificationReason: null }
        : { preQualified: false, disqualificationReason: recoveryReason },
    });
    await persistCostEvents(prisma, discoveryRunId, businessId, costEvents);
    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
    return;
  }

  const leadEmail = contactEmail;
  const isCurrentRunExistingBusiness = business.discoveryRunId !== discoveryRunId;

  const hasRealDecisionMaker = resolvedContact !== null && isValidPersonName(resolvedContact.name, business.name);
  const contactStatus: ContactResolutionStatus = hasRealDecisionMaker
    ? (resolvedContact?.verificationVerdict === 'verified' || resolvedContact?.linkedinUrl ? 'verified' : 'discovered')
    : 'unresolved';
  const shouldAutoReject = false;
  recoveryTelemetry.finalOutcome = 'lead_created';

  // ── 7. Derive lead source from actual provider ───────────────────────────
  let leadSource = 'SERPAPI_DISCOVERY';
  const evidence = await prisma.businessEvidence.findFirst({
    where: { businessId },
    select: {
      id: true,
      sourceType: true,
      serpapiResultId: true,
      rawJson: true,
      createdAt: true,
      searchTask: {
        select: {
          id: true,
          taskType: true,
          queryHash: true,
          paramsJson: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (evidence?.sourceType) {
    leadSource = evidence.sourceType.includes('GOOGLE_PLACES')
      ? 'GOOGLE_PLACES_DISCOVERY'
      : evidence.sourceType.includes('SERP')
        ? 'SERPAPI_DISCOVERY'
        : evidence.sourceType;
  }

  // ── 8. Create Lead + BusinessConversion + BusinessContacts + CostEvents in ONE tx ─
  const resolvedName = resolvedContact ? parseName(resolvedContact.name) : { firstName: 'Unknown', lastName: 'Contact' };

  const txResult = await prisma.$transaction(async (tx) => {
    if (isCurrentRunExistingBusiness) {
      const sameBusinessLeads = await tx.lead.findMany({
        where: {
          businessId: business.id,
          deletedAt: null,
        },
        select: { id: true, businessId: true },
        orderBy: { createdAt: 'asc' },
        take: 2,
      });

      if (sameBusinessLeads.length !== 1) {
        if (allCandidates.length > 0) {
          await tx.businessContact.createMany({
            data: allCandidates.slice(0, 5).map((c) => ({
              businessId: business.id,
              name: c.name,
              title: c.title,
              email: c.email,
              phone: c.phone,
              linkedinUrl: c.linkedinUrl,
              seniority: c.seniority,
              positionRank: c.positionRank,
              source: c.source,
            })),
            skipDuplicates: true,
          });
        }

        await persistCostEvents(tx as unknown as typeof prisma, discoveryRunId, businessId, costEvents);

        return {
          isNew: false,
          unsupportedExistingBusinessLeadCount: sameBusinessLeads.length,
        };
      }

      const existingBusinessLead = sameBusinessLeads[0]!;
      logger.info(
        {
          ...logCtx,
          existingLeadId: existingBusinessLead.id,
          sameBusinessLeadCount: sameBusinessLeads.length,
        },
        'Existing business rediscovery matched a single active same-business lead',
      );

      await tx.businessConversion.create({
        data: {
          businessId: business.id,
          leadId: existingBusinessLead.id,
          icpProfileId,
          apolloContactJson: apolloContactJson
            ? toInputJson(apolloContactJson)
            : PrismaRuntime.JsonNull,
          hunterContactJson: hunterContactJson
            ? toInputJson(hunterContactJson)
            : PrismaRuntime.JsonNull,
          apolloHasEmail,
          apolloHasDirectPhone,
          metadata: toInputJson({
            discoveryRunId,
            contactStatus,
            contactRecovery: {
              telemetry: recoveryTelemetry,
              attempts: recoveryAttempts,
              topSourceFamily: recoveryTelemetry.topSourceFamily,
              topQueryFamily: recoveryTelemetry.topQueryFamily,
              diagnostics: recoveryTelemetry.diagnostics,
              verificationVerdict: recoveryTelemetry.verificationVerdict,
              supportingUrls: recoveryTelemetry.supportingUrls,
              topCandidates: cseTopCandidates,
              identityConfidence: Number(identityConfidence.toFixed(3)),
              contactConfidence: Number(contactConfidence.toFixed(3)),
              terminalReason: null,
              resolutionState: 'lead_created',
              adjudication,
              winnerSelectionMethod,
            },
            contactProvenance: allCandidates.slice(0, 5).map((c) => ({
              name: c.name,
              source: c.source,
              sourceStage: null,
              confidence: c.confidence ?? null,
              matchedSignals: c.matchedSignals ?? [],
              verificationVerdict: c.verificationVerdict ?? 'skipped',
              supportingUrls: dedupeUrls(c.supportingUrls ?? []),
              hasEmail: c.email !== null,
              hasLinkedin: c.linkedinUrl !== null,
            })),
            confidence: {
              identityConfidence: Number(identityConfidence.toFixed(3)),
              contactConfidence: Number(contactConfidence.toFixed(3)),
            },
            decisionProvenance: {
              winnerSelectionMethod,
              selectedCandidateName: resolvedContact?.name ?? null,
              selectedCandidateTitle: resolvedContact?.title ?? null,
              selectedCandidateEmail: contactEmail,
              selectedCandidateTier: resolvedContact?.title ? getDecisionMakerTier(resolvedContact.title) : null,
              adjudicationVerdict: adjudication?.verdict ?? null,
              adjudicationConfidenceBucket: adjudication?.confidenceBucket ?? null,
              adjudicationRationale: adjudication?.rationale ?? null,
            },
            rediscovery: {
              mode: 'existing_business_same_lead',
            },
          }),
          ...(businessInsights !== null ? { businessInsights } : {}),
        },
      }).catch((err: unknown) => {
        if (
          err instanceof PrismaRuntime.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          logger.info(
            { ...logCtx, existingLeadId: existingBusinessLead.id },
            'BusinessConversion already exists for existing business rediscovery — skipping duplicate',
          );
          return;
        }
        throw err;
      });

      if (allCandidates.length > 0) {
        await tx.businessContact.createMany({
          data: allCandidates.slice(0, 5).map((c) => ({
            businessId: business.id,
            name: c.name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            linkedinUrl: c.linkedinUrl,
            seniority: c.seniority,
            positionRank: c.positionRank,
            source: c.source,
          })),
          skipDuplicates: true,
        });
      }

      await persistCostEvents(tx as unknown as typeof prisma, discoveryRunId, businessId, costEvents);

      return {
        lead: existingBusinessLead,
        isNew: false,
        reusedPrimaryBusiness: true,
      };
    }

    // Check for existing lead with same email (dedup)
    const existingLead = await tx.lead.findFirst({
      where: { email: leadEmail },
      select: { id: true, deletedAt: true, businessId: true },
    });

    if (existingLead?.deletedAt) {
      logger.warn(
        { ...logCtx, softDeletedLeadId: existingLead.id, email: leadEmail, deletedAt: existingLead.deletedAt },
        'Lead with this email is soft-deleted — treating convert as terminal',
      );

      // Keep business-level contact evidence, but do not link a soft-deleted lead.
      if (allCandidates.length > 0) {
        await tx.businessContact.createMany({
          data: allCandidates.slice(0, 5).map((c) => ({
            businessId: business.id,
            name: c.name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            linkedinUrl: c.linkedinUrl,
            seniority: c.seniority,
            positionRank: c.positionRank,
            source: c.source,
          })),
          skipDuplicates: true,
        });
      }

      await persistCostEvents(tx as unknown as typeof prisma, discoveryRunId, businessId, costEvents);

      return { lead: existingLead, isNew: false, softDeletedEmailCollision: true as const };
    }

    if (existingLead) {
      logger.info(
        { ...logCtx, existingLeadId: existingLead.id, email: leadEmail },
        'Lead with this email already exists — linking via BusinessConversion',
      );

      await tx.businessConversion.create({
        data: {
          businessId: business.id,
          leadId: existingLead.id,
          icpProfileId,
          apolloContactJson: apolloContactJson
            ? toInputJson(apolloContactJson)
            : PrismaRuntime.JsonNull,
          hunterContactJson: hunterContactJson
            ? toInputJson(hunterContactJson)
            : PrismaRuntime.JsonNull,
          apolloHasEmail,
          apolloHasDirectPhone,
              metadata: toInputJson({
                discoveryRunId,
                contactStatus,
                contactRecovery: {
                  telemetry: recoveryTelemetry,
                  attempts: recoveryAttempts,
                  topSourceFamily: recoveryTelemetry.topSourceFamily,
                  topQueryFamily: recoveryTelemetry.topQueryFamily,
                  diagnostics: recoveryTelemetry.diagnostics,
                  verificationVerdict: recoveryTelemetry.verificationVerdict,
                  supportingUrls: recoveryTelemetry.supportingUrls,
                  topCandidates: cseTopCandidates,
                  identityConfidence: Number(identityConfidence.toFixed(3)),
                  contactConfidence: Number(contactConfidence.toFixed(3)),
                  terminalReason: null,
                  resolutionState: 'lead_created',
                  adjudication,
                  winnerSelectionMethod,
                },
                contactProvenance: allCandidates.slice(0, 5).map((c) => ({
                  name: c.name,
                  source: c.source,
                  sourceStage: null,
                  confidence: c.confidence ?? null,
                  matchedSignals: c.matchedSignals ?? [],
                  verificationVerdict: c.verificationVerdict ?? 'skipped',
                  supportingUrls: dedupeUrls(c.supportingUrls ?? []),
                  hasEmail: c.email !== null,
                  hasLinkedin: c.linkedinUrl !== null,
                })),
                confidence: {
                  identityConfidence: Number(identityConfidence.toFixed(3)),
                  contactConfidence: Number(contactConfidence.toFixed(3)),
                },
                decisionProvenance: {
                  winnerSelectionMethod,
                  selectedCandidateName: resolvedContact?.name ?? null,
                  selectedCandidateTitle: resolvedContact?.title ?? null,
                  selectedCandidateEmail: contactEmail,
                  selectedCandidateTier: resolvedContact?.title ? getDecisionMakerTier(resolvedContact.title) : null,
                  adjudicationVerdict: adjudication?.verdict ?? null,
                  adjudicationConfidenceBucket: adjudication?.confidenceBucket ?? null,
                  adjudicationRationale: adjudication?.rationale ?? null,
                },
              }),
              ...(businessInsights !== null ? { businessInsights } : {}),
            },
          }).catch((err: unknown) => {
        if (
          err instanceof PrismaRuntime.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          logger.info(
            { ...logCtx, existingLeadId: existingLead.id },
            'BusinessConversion already exists — skipping duplicate',
          );
          return;
        }
        throw err;
      });

      // Create BusinessContact rows even for existing leads (store ALL discovered contacts)
      if (allCandidates.length > 0) {
        await tx.businessContact.createMany({
          data: allCandidates.slice(0, 5).map((c) => ({
            businessId: business.id,
            name: c.name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            linkedinUrl: c.linkedinUrl,
            seniority: c.seniority,
            positionRank: c.positionRank,
            source: c.source,
          })),
          skipDuplicates: true,
        });
      }

      // Record cost events
      await persistCostEvents(tx as unknown as typeof prisma, discoveryRunId, businessId, costEvents);

      return {
        lead: existingLead,
        isNew: false,
        reusedPrimaryBusiness: existingLead.businessId === business.id,
      };
    }

    // Determine first/last name — never use business name as fallback (B1)
    const firstName = resolvedName.firstName || 'Unknown';
    const lastName = resolvedName.lastName || 'Contact';

    const lead = await tx.lead.create({
      data: {
        firstName,
        lastName,
        email: leadEmail,
        phone: resolvedContact?.phone ?? null,
        ...(phoneSource !== null ? { phoneSource } : {}),
        ...(businessEmailField !== null && contactEmail !== null
          ? { businessEmail: businessEmailField }
          : {}),
        ...(contactEmail === null && businessEmailField !== null
          ? { businessEmail: businessEmailField }
          : {}),
        businessId: business.id,
        decisionMakerTitle: resolvedContact?.title ?? null,
        decisionMakerPhone: resolvedContact?.phone ?? null,
        source: leadSource,
        status: shouldAutoReject ? 'rejected' : isDraftedLead ? 'drafted' : 'new',
      },
    });

    // Auto-reject: create LeadRejection record (B10)
    if (shouldAutoReject) {
      await tx.leadRejection.create({
        data: {
          leadId: lead.id,
          businessId: business.id,
          domain,
          icpProfileId,
          reason: 'NO_DECISION_MAKER',
          rejectedBy: 'system:business.convert',
          metadata: toInputJson({
            candidateCount: allCandidates.length,
            hasGenericEmailOnly: contactEmail === null && businessEmailField !== null,
            contactStatus,
            failedHardFilters: ['NO_DECISION_MAKER'],
          }),
        },
      });
      logger.info(
        { ...logCtx, leadId: lead.id, reason: 'NO_DECISION_MAKER' },
        'Lead auto-rejected — no valid decision maker found',
      );
    }

    await tx.businessConversion.create({
      data: {
        businessId: business.id,
        leadId: lead.id,
        icpProfileId,
        apolloContactJson: apolloContactJson
          ? toInputJson(apolloContactJson)
          : PrismaRuntime.JsonNull,
        hunterContactJson: hunterContactJson
          ? toInputJson(hunterContactJson)
          : PrismaRuntime.JsonNull,
        apolloHasEmail,
        apolloHasDirectPhone,
        metadata: toInputJson({
          contactSource: resolvedContact?.source ?? 'unknown',
          contactStatus,
          contactRecovery: {
            telemetry: recoveryTelemetry,
            attempts: recoveryAttempts,
            topSourceFamily: recoveryTelemetry.topSourceFamily,
            topQueryFamily: recoveryTelemetry.topQueryFamily,
            diagnostics: recoveryTelemetry.diagnostics,
            verificationVerdict: recoveryTelemetry.verificationVerdict,
            supportingUrls: recoveryTelemetry.supportingUrls,
            topCandidates: cseTopCandidates,
            identityConfidence: Number(identityConfidence.toFixed(3)),
            contactConfidence: Number(contactConfidence.toFixed(3)),
            terminalReason: null,
            resolutionState: 'lead_created',
            adjudication,
            winnerSelectionMethod,
          },
          contactProvenance: allCandidates.slice(0, 5).map((c) => ({
            name: c.name,
            source: c.source,
            sourceStage: null,
            confidence: c.confidence ?? null,
            matchedSignals: c.matchedSignals ?? [],
            verificationVerdict: c.verificationVerdict ?? 'skipped',
            supportingUrls: dedupeUrls(c.supportingUrls ?? []),
            hasEmail: c.email !== null,
            hasLinkedin: c.linkedinUrl !== null,
          })),
          confidence: {
            identityConfidence: Number(identityConfidence.toFixed(3)),
            contactConfidence: Number(contactConfidence.toFixed(3)),
          },
          decisionProvenance: {
            winnerSelectionMethod,
            selectedCandidateName: resolvedContact?.name ?? null,
            selectedCandidateTitle: resolvedContact?.title ?? null,
            selectedCandidateEmail: contactEmail,
            selectedCandidateTier: resolvedContact?.title ? getDecisionMakerTier(resolvedContact.title) : null,
            adjudicationVerdict: adjudication?.verdict ?? null,
            adjudicationConfidenceBucket: adjudication?.confidenceBucket ?? null,
            adjudicationRationale: adjudication?.rationale ?? null,
          },
          discoveryRunId,
        }),
        ...(businessInsights !== null ? { businessInsights } : {}),
      },
    });

    // Create BusinessContact rows for ALL scraped contacts (store all discovered contacts)
    if (allCandidates.length > 0) {
      await tx.businessContact.createMany({
        data: allCandidates.slice(0, 5).map((c) => ({
          businessId: business.id,
          name: c.name,
          title: c.title,
          email: c.email,
          phone: c.phone,
          linkedinUrl: c.linkedinUrl,
          seniority: c.seniority,
          positionRank: c.positionRank,
          source: c.source,
        })),
        skipDuplicates: true,
      });
    }

    // Record cost events inside transaction
    await persistCostEvents(tx as unknown as typeof prisma, discoveryRunId, businessId, costEvents);

    return { lead, isNew: true };
  });

  await prisma.contactRecoveryItem.deleteMany({
    where: {
      businessId: business.id,
      icpProfileId,
    },
  });

  if (txResult.softDeletedEmailCollision) {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        preQualified: false,
        disqualificationReason: 'SOFT_DELETED_LEAD_EMAIL_CONFLICT',
      },
    });

    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
    return;
  }

  let restoredExistingLeadIcpLineage = false;
  let existingLeadAlreadyKnownNoop = false;
  const txLeadId = 'lead' in txResult ? txResult.lead.id : null;
  const txLeadBusinessId = 'lead' in txResult ? txResult.lead.businessId ?? null : null;

  if ((txResult.isNew || txResult.reusedPrimaryBusiness) && !txLeadId) {
    throw new Error('business.convert invariant violated: missing lead for persisted tx result');
  }
  const requiredLeadId = txLeadId!;

  if (txResult.isNew) {
    // New leads still write the full canonical lineage/enrichment records here.
    // Reused same-primary leads reconcile current-ICP discovery lineage below.
    if (evidence?.searchTask) {
      const provider = resolveDiscoveryProvider(evidence.searchTask.paramsJson as Prisma.JsonValue | null);
      const providerRecordId = evidence.serpapiResultId ?? evidence.id;
      await prisma.leadDiscoveryRecord.upsert({
        where: {
          leadId_icpProfileId_provider_providerRecordId: {
            leadId: requiredLeadId,
            icpProfileId,
            provider,
            providerRecordId,
          },
        },
        create: {
          leadId: requiredLeadId,
          icpProfileId,
          provider,
          providerSource: evidence.sourceType,
          providerRecordId,
          queryHash: evidence.searchTask.queryHash,
          rawPayload: toInputJson(evidence.rawJson),
          provenanceJson: toInputJson({
            businessId,
            discoveryRunId,
            searchTaskId: evidence.searchTask.id,
            taskType: evidence.searchTask.taskType,
          }),
          discoveredAt: evidence.createdAt,
        },
        update: {
          providerSource: evidence.sourceType,
          rawPayload: toInputJson(evidence.rawJson),
          provenanceJson: toInputJson({
            businessId,
            discoveryRunId,
            searchTaskId: evidence.searchTask.id,
            taskType: evidence.searchTask.taskType,
          }),
        },
      });
    }

    if (hunterContactJson) {
      const requestKey = `hunter:convert:${requiredLeadId}:${icpProfileId}:${discoveryRunId}`;
      await prisma.leadEnrichmentRecord.upsert({
        where: { requestKey },
        create: {
          leadId: requiredLeadId,
          provider: 'HUNTER',
          status: 'COMPLETED',
          requestKey,
          normalizedPayload: toInputJson({
            contacts: hunterContactJson,
            source: 'business.convert',
          }),
          rawPayload: toInputJson(hunterContactJson),
          enrichedAt: new Date(),
        },
        update: {
          status: 'COMPLETED',
          normalizedPayload: toInputJson({
            contacts: hunterContactJson,
            source: 'business.convert',
          }),
          rawPayload: toInputJson(hunterContactJson),
          enrichedAt: new Date(),
        },
      });
    }
  } else {
    if (txResult.reusedPrimaryBusiness && txLeadId) {
      const [existingDraft, existingScore] = await Promise.all([
        prisma.messageDraft.findFirst({
          where: { leadId: txLeadId, icpProfileId },
          select: { id: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        prisma.leadScorePrediction.findFirst({
          where: { leadId: txLeadId, icpProfileId },
          select: { id: true },
          orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);

      if (existingDraft || existingScore) {
        existingLeadAlreadyKnownNoop = true;
        gateStats.outcome = 'existing_already_known';
        logger.info(
          {
            ...logCtx,
            leadId: txLeadId,
            messageDraftId: existingDraft?.id ?? null,
            scorePredictionId: existingScore?.id ?? null,
          },
          'Existing business rediscovery already has current ICP downstream state; treating it as an explicit already-known no-op',
        );
      } else if (!shouldAutoReject && !isDraftedLead && deps.enqueueFeaturesCompute) {
        await deps.enqueueFeaturesCompute({
          runId: discoveryRunId,
          leadId: txLeadId,
          icpProfileId,
          snapshotVersion: 1,
          correlationId: effectiveCorrelationId,
        });

        restoredExistingLeadIcpLineage = true;
        gateStats.outcome = 'existing_reentered';
        logger.info(
          {
            ...logCtx,
            leadId: txLeadId,
          },
          'Existing business rediscovery re-entered shared features.compute for the single active same-business lead',
        );
      } else {
        gateStats.outcome = 'existing_pending';
        logger.info(
          {
            ...logCtx,
            leadId: txLeadId,
            enqueueFeaturesComputeConfigured: deps.enqueueFeaturesCompute ? true : false,
          },
          'Existing business rediscovery found a single active same-business lead but did not enqueue features.compute',
        );
      }
    } else if (txResult.unsupportedExistingBusinessLeadCount !== undefined) {
      existingLeadAlreadyKnownNoop = true;
      gateStats.outcome = 'existing_unsupported';
      logger.info(
        {
          ...logCtx,
          sameBusinessLeadCount: txResult.unsupportedExistingBusinessLeadCount,
        },
        'Existing business rediscovery is terminal because it does not map to exactly one active same-business lead',
      );
    } else {
      existingLeadAlreadyKnownNoop = true;
      gateStats.outcome = 'existing_terminal';
      logger.info(
        {
          ...logCtx,
          leadId: txLeadId,
          primaryBusinessId: txLeadBusinessId,
        },
        'Existing lead reuse remains terminal because the rediscovered business is not the lead primary business',
      );
    }
  }

  // ── 9. Enqueue features.compute if lead is newly created and NOT auto-rejected ─
  if (txResult.isNew && !shouldAutoReject && !isDraftedLead && deps.enqueueFeaturesCompute) {
    await deps.enqueueFeaturesCompute({
      runId: discoveryRunId,
      leadId: requiredLeadId,
      icpProfileId,
      snapshotVersion: 1,
      correlationId: effectiveCorrelationId,
    });

    logger.info(
      { ...logCtx, leadId: txLeadId },
      'Enqueued features.compute for newly created lead',
    );
  }

  // ── 10. Check if lead target reached — flag run for graceful cancellation ─
  if (txResult.isNew) {
    const targetReached = await checkLeadTargetReached(discoveryRunId, logger);
    if (targetReached) {
      logger.info(
        { ...logCtx, leadId: txLeadId },
        'Lead target reached — remaining pipeline jobs will be skipped',
      );
    }
  }

  if (!txResult.isNew) {
    await tryFinalizeDiscoveryRun(discoveryRunId, logger, trackerSelfExclusion);
  }

  // ── 11. Completion log ────────────────────────────────────────────────
  if (gateStats.outcome === 'pending') {
    gateStats.outcome = isDraftedLead ? 'drafted' : 'lead_created';
  }
  logger.info(
    {
      ...logCtx,
      leadId: txLeadId,
      isNewLead: txResult.isNew,
      restoredExistingLeadIcpLineage,
      existingLeadAlreadyKnownNoop,
      isDraftedLead,
      autoRejected: shouldAutoReject,
      contactSource: resolvedContact?.source ?? 'none',
      businessContactCount: Math.min(allCandidates.length, 5),
      paidProvidersCalled: costEvents.length,
      leadSource,
      gateStats,
    },
    'Completed business.convert job',
  );
}
