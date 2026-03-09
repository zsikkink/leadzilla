import { Prisma, prisma, toInputJson } from '@lead-flood/db';
import type {
  ContactRecoveryAttempt,
  ContactRecoveryCandidate,
  ContactRecoveryOutcome,
  ContactRecoverySnapshot,
  ContactRecoveryTelemetry,
} from '@lead-flood/contracts';
import type { Job, SendOptions } from 'pg-boss';

import { RetryableError } from '../errors.js';
import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';
import { isProviderWithinBudget } from '../utils/pipeline-settings.js';
import {
  extractDecisionMakers,
  validateExtractedContacts,
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
type ContactDiscoveryQueryFamily =
  | 'V1_linkedin_exact'
  | 'V2_company_domain_exact'
  | 'V3_public_web_exact'
  | 'V4_exact_without_title'
  | 'D1_linkedin_roles'
  | 'D2_company_team_pages'
  | 'D3_company_about_pages'
  | 'D4_press_news_mentions'
  | 'D5_public_web_role_queries'
  | 'D6_locality_first_queries';

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
  linkedInSearchAdapter?: {
    searchCompanyPeople(input: {
      companyName: string;
      companyDomain?: string | null | undefined;
      cityOrCountry?: string | null | undefined;
      maxResults?: number | undefined;
    }): Promise<
      | {
          status: 'success';
          data: Array<{
            name: string;
            title: string | null;
            linkedinUrl: string | null;
            sourceType: string;
            sourceUrl: string;
            sourceDomain: string | null;
            companyHint: string | null;
            matchSignals: string[];
            relevanceScore: number;
          }>;
          diagnostics: Array<{
            stage: string;
            query: string;
            sourceFamily: 'linkedin' | 'company_page' | 'public_web' | 'mixed' | 'unknown';
            queryFamily: ContactDiscoveryQueryFamily;
            rawResultCount: number;
            promotedCount: number;
            verdict: ContactVerificationVerdict;
          }>;
          topSourceFamily: 'linkedin' | 'company_page' | 'public_web' | 'mixed' | 'unknown';
          topQueryFamily: ContactDiscoveryQueryFamily | null;
        }
      | { status: 'retryable_error'; failure: { message: string } }
      | { status: 'terminal_error'; failure: { message: string } }
    >;
    searchPersonVerification(input: {
      name: string;
      companyName: string;
      companyDomain?: string | null | undefined;
      cityOrCountry?: string | null | undefined;
      titleOrFunction?: string | null | undefined;
      maxResults?: number | undefined;
    }): Promise<
      | {
          status: 'success';
          data: Array<{
            name: string;
            title: string | null;
            linkedinUrl: string | null;
            sourceType: string;
            sourceUrl: string;
            sourceDomain: string | null;
            companyHint: string | null;
            matchSignals: string[];
            relevanceScore: number;
          }>;
          diagnostics: Array<{
            stage: string;
            query: string;
            sourceFamily: 'linkedin' | 'company_page' | 'public_web' | 'mixed' | 'unknown';
            queryFamily: ContactDiscoveryQueryFamily;
            rawResultCount: number;
            promotedCount: number;
            verdict: ContactVerificationVerdict;
          }>;
          topSourceFamily: 'linkedin' | 'company_page' | 'public_web' | 'mixed' | 'unknown';
          topQueryFamily: ContactDiscoveryQueryFamily | null;
        }
      | { status: 'retryable_error'; failure: { message: string } }
      | { status: 'terminal_error'; failure: { message: string } }
    >;
    isConfigured: boolean;
  } | undefined;
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
  source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo' | 'google_custom_search';
  hasEmail: boolean;
  hasLinkedin: boolean;
  seniority: 'executive' | 'director' | 'manager' | 'other';
}): number {
  let score = 0.35;
  if (input.hasEmail) score += 0.25;
  if (input.hasLinkedin) score += 0.2;
  if (input.source === 'website_scrape') score += 0.1;
  if (input.source === 'apollo') score += 0.05;
  if (input.source === 'google_custom_search') score += 0.08;
  if (input.seniority === 'executive') score += 0.1;
  if (input.seniority === 'director') score += 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
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
): Promise<Array<{ email: string; dm: { name: string; title: string | null; seniority: string }; pattern: string }>> {
  if (!smtpVerifier || knownEmails.length === 0 || decisionMakers.length === 0) return [];

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
  if (!dominantPattern) return [];

  // Generate candidates for DMs using the dominant pattern
  const results: Array<{ email: string; dm: { name: string; title: string | null; seniority: string }; pattern: string }> = [];

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

    const verification = await smtpVerifier.verify(candidate);
    if (verification.status === 'valid' || verification.status === 'catch_all') {
      results.push({ email: candidate, dm, pattern: dominantPattern });
    }
  }

  return results;
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

/** Classify seniority from a title string (local version for Hunter/Apollo contacts). */
function classifySeniorityLocal(title: string): 'executive' | 'director' | 'manager' | 'other' {
  const lower = title.toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cmo|cpo|cio|founder|co-founder|cofounder|owner|president|chairm)/i.test(lower)) {
    return 'executive';
  }
  if (/\b(director|vp|vice\s*president|head\s+of|svp|evp)/i.test(lower)) {
    return 'director';
  }
  if (/\b(manager|lead|supervisor|coordinator)/i.test(lower)) {
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
  };
}

async function upsertContactRecoveryItem(input: {
  businessId: string;
  icpProfileId: string;
  discoveryRunId: string;
  reason: 'NO_CONTACTS_FOUND' | 'NO_EMAIL';
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

  logger.info(logCtx, 'Started business.convert job');

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
    },
  });

  if (!business) {
    logger.warn(logCtx, 'Business not found — skipping conversion');
    await prisma.business.update({
      where: { id: businessId },
      data: { preQualified: false, disqualificationReason: 'BUSINESS_NOT_FOUND' },
    }).catch(() => { /* Business truly doesn't exist — nothing to update */ });
    await tryFinalizeDiscoveryRun(discoveryRunId, logger);
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
    await tryFinalizeDiscoveryRun(discoveryRunId, logger);
    return;
  }

  const domain = business.websiteDomain;

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
    source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo' | 'google_custom_search';
    sourceStage?: 'V1' | 'V2' | 'D1' | 'D2' | undefined;
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
    cseCandidatesAdded: 0,
    totalCandidates: 0,
    withEmail: 0,
    outcome: 'pending' as string,
  };
  let apolloContactJson: unknown = null;
  let hunterContactJson: unknown = null;
  const costEvents: Array<{ provider: 'APOLLO' | 'HUNTER' | 'SERPAPI' | 'GOOGLE_CUSTOM_SEARCH'; costCents: number; apiCallType: string }> = [];
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

      const inferred = await inferEmailPattern(
        knownEmails,
        domain,
        dmsForInference,
        deps.smtpVerifier?.isConfigured ? deps.smtpVerifier : undefined,
      );

      for (const { email: inferredEmail, dm, pattern } of inferred) {
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
  const hasValidEmail = allCandidates.some((c) => c.email !== null);
  let hunterRetryable = false;
  let apolloRetryable = false;

  if (!hasValidEmail) {
    logger.info(logCtx, 'No valid email from scrape data — falling back to paid providers');

    // Hunter (cheaper) — check budget ceiling first
    const hunterWithinBudget = await isProviderWithinBudget('HUNTER');
    if (!hunterWithinBudget) {
      logger.warn(logCtx, 'Hunter daily budget ceiling exceeded — skipping paid lookup');
    }
    if (deps.hunterAdapter.isConfigured && hunterWithinBudget) {
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
        costEvents.push({ provider: 'HUNTER', costCents: 1, apiCallType: 'domain_search' });
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

    // Apollo (more expensive — only if pre-screen says email exists + within budget)
    const hasEmailAfterHunter = allCandidates.some((c) => c.email !== null);
    const apolloWithinBudget = await isProviderWithinBudget('APOLLO');
    if (!hasEmailAfterHunter && !apolloWithinBudget) {
      logger.warn(logCtx, 'Apollo daily budget ceiling exceeded — skipping paid lookup');
    }
    if (!hasEmailAfterHunter && deps.apolloAdapter.isConfigured && apolloHasEmail && apolloWithinBudget) {
      const apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);
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
      if (apolloResult.status === 'success') {
        costEvents.push({ provider: 'APOLLO', costCents: 1, apiCallType: 'contact_search' });
      }
      logger.info(
        { ...logCtx, apolloStatus: apolloResult.status, contactsFound: apolloResult.status === 'success' ? apolloResult.contacts.length : 0 },
        'Apollo contact search completed (fallback)',
      );
      recoveryAttempts.push({
        stage: 'contact_recovery',
        provider: 'APOLLO',
        mode: 'discover',
        status: apolloResult.status,
        resultCount: apolloResult.status === 'success' ? apolloResult.contacts.length : 0,
        notes: [],
      });
    }
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
      // Build a minimal HTML-like text from the scrape data for LLM
      const pageText = [
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

  // ── 5g. LLM validation — filter garbage from ALL contacts (B9)
  if (deps.llmExtractionConfig?.openAiApiKey && allCandidates.length > 0) {
    const candidatesForValidation = allCandidates
      .filter((c) => c.name !== 'Unknown Contact')
      .map((c) => ({ name: c.name, title: c.title }));

    if (candidatesForValidation.length > 0) {
      const validated = await validateExtractedContacts(
        candidatesForValidation,
        business.name,
        deps.llmExtractionConfig,
      );

      const fakenames = new Set(
        validated
          .filter((v) => !v.isRealPerson)
          .map((v) => v.name.toLowerCase()),
      );

      gateStats.llmFakeNames = fakenames.size;
      if (fakenames.size > 0) {
        // Remove fake-name candidates from allCandidates
        for (let i = allCandidates.length - 1; i >= 0; i--) {
          if (fakenames.has(allCandidates[i]!.name.toLowerCase())) {
            logger.info(
              { ...logCtx, fakeName: allCandidates[i]!.name },
              'LLM validation rejected contact as not a real person',
            );
            allCandidates.splice(i, 1);
          }
        }
      }
    }
  }

  // ── 5h. Rule-based name validation — apply to ALL remaining candidates (B2)
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

  // ── 5i. Google Custom Search 4-stage contact intelligence ─────────────
  // Path A (found contacts): V1 people verify + V2 LinkedIn verify
  // Path B (no contacts): D1 people discover + D2 LinkedIn discover
  const locality = [business.city, business.countryCode].filter(Boolean).join(', ') || null;
  if (deps.linkedInSearchAdapter?.isConfigured) {
    const candidatesWithNames = allCandidates
      .filter((c) => c.name !== 'Unknown Contact' && isValidPersonName(c.name, business.name))
      .slice(0, 3);

    if (candidatesWithNames.length > 0) {
      recoveryTelemetry.cseVerifyAttempted = true;
      let verifyMatches = 0;
      for (const candidate of candidatesWithNames) {
        const verifyResult = await deps.linkedInSearchAdapter.searchPersonVerification({
          name: candidate.name,
          companyName: business.name,
          companyDomain: domain,
          cityOrCountry: locality,
          titleOrFunction: candidate.title,
          maxResults: 3,
        });
        costEvents.push({ provider: 'GOOGLE_CUSTOM_SEARCH', costCents: 0, apiCallType: 'linkedin_verify' });
        if (verifyResult.status === 'success') {
          recoveryTelemetry.cseRawResults += verifyResult.diagnostics.reduce(
            (sum, diagnostic) => sum + diagnostic.rawResultCount,
            0,
          );
          recoveryTelemetry.diagnostics.push(
            ...verifyResult.diagnostics.map((diagnostic) => ({
              stage: diagnostic.stage,
              sourceFamily: diagnostic.sourceFamily,
              queryFamily: diagnostic.queryFamily,
              rawResultCount: diagnostic.rawResultCount,
              promotedCount: diagnostic.promotedCount,
              verdict: diagnostic.verdict,
            })),
          );
          const validProfiles = verifyResult.data.filter((profile) => isValidPersonName(profile.name, business.name));
          recoveryTelemetry.cseValidProfiles += validProfiles.length;
          recoveryTelemetry.topSourceFamily =
            recoveryTelemetry.topSourceFamily === 'unknown'
              ? verifyResult.topSourceFamily
              : recoveryTelemetry.topSourceFamily;
          recoveryTelemetry.topQueryFamily = recoveryTelemetry.topQueryFamily ?? verifyResult.topQueryFamily;
          const exactMatch = verifyResult.data.find((p) =>
            p.name.toLowerCase() === candidate.name.toLowerCase(),
          );
          if (exactMatch) {
            candidate.verificationVerdict = 'verified';
            candidate.supportingUrls = dedupeUrls([...(candidate.supportingUrls ?? []), exactMatch.sourceUrl]);
            recoveryTelemetry.supportingUrls = dedupeUrls([...recoveryTelemetry.supportingUrls, exactMatch.sourceUrl]);
            verifyMatches += 1;
            recoveryTelemetry.cseCandidatesValidated += 1;
          } else if (verifyResult.data[0]) {
            candidate.verificationVerdict = 'inconclusive';
            candidate.supportingUrls = dedupeUrls([...(candidate.supportingUrls ?? []), verifyResult.data[0].sourceUrl]);
          }
        }
      }
      recoveryTelemetry.cseVerifySucceeded = verifyMatches > 0;
      recoveryTelemetry.verificationVerdict = verifyMatches > 0 ? 'verified' : 'inconclusive';
      recoveryAttempts.push({
        stage: 'contact_recovery',
        provider: 'GOOGLE_CUSTOM_SEARCH',
        mode: 'verify',
        status: verifyMatches > 0 ? 'success' : 'empty',
        resultCount: verifyMatches,
        notes: verifyMatches > 0
          ? [`Verification resolved via ${recoveryTelemetry.topSourceFamily.replace('_', ' ')}`]
          : [],
      });
    } else {
      recoveryTelemetry.verificationVerdict = 'skipped';
      recoveryAttempts.push({
        stage: 'contact_recovery',
        provider: 'GOOGLE_CUSTOM_SEARCH',
        mode: 'verify',
        status: 'skipped',
        resultCount: 0,
        notes: ['No validated named candidates were available to verify'],
      });
    }

    const hasStrongVerifiedCandidate = allCandidates.some(
      (candidate) => candidate.linkedinUrl !== null || candidate.email !== null,
    );
    if (!hasStrongVerifiedCandidate) {
      recoveryTelemetry.cseDiscoverAttempted = true;
      const seenNames = new Set(allCandidates.map((candidate) => candidate.name.toLowerCase()));
      let addedCandidates = 0;
      const discoverResult = await deps.linkedInSearchAdapter.searchCompanyPeople({
        companyName: business.name,
        companyDomain: domain,
        cityOrCountry: locality,
        maxResults: 5,
      });
      costEvents.push({ provider: 'GOOGLE_CUSTOM_SEARCH', costCents: 0, apiCallType: 'linkedin_discover' });
      if (discoverResult.status === 'success') {
        recoveryTelemetry.cseRawResults += discoverResult.diagnostics.reduce(
          (sum, diagnostic) => sum + diagnostic.rawResultCount,
          0,
        );
        recoveryTelemetry.diagnostics.push(
          ...discoverResult.diagnostics.map((diagnostic) => ({
            stage: diagnostic.stage,
            sourceFamily: diagnostic.sourceFamily,
            queryFamily: diagnostic.queryFamily,
            rawResultCount: diagnostic.rawResultCount,
            promotedCount: diagnostic.promotedCount,
            verdict: diagnostic.verdict,
          })),
        );
        recoveryTelemetry.topSourceFamily = discoverResult.topSourceFamily;
        recoveryTelemetry.topQueryFamily = recoveryTelemetry.topQueryFamily ?? discoverResult.topQueryFamily;

        for (const profile of discoverResult.data) {
          if (!isValidPersonName(profile.name, business.name)) {
            continue;
          }

          recoveryTelemetry.cseValidProfiles += 1;

          const normalizedName = profile.name.toLowerCase();
          if (seenNames.has(normalizedName)) {
            continue;
          }

          seenNames.add(normalizedName);
          addedCandidates += 1;
          recoveryTelemetry.cseCandidatesAdded += 1;
          recoveryTelemetry.cseCandidatesValidated += 1;
          gateStats.cseCandidatesAdded++;
          allCandidates.push({
            name: profile.name,
            title: profile.title,
            email: null,
            phone: null,
            linkedinUrl: profile.linkedinUrl,
            seniority: profile.title ? classifySeniorityLocal(profile.title) : 'other',
            positionRank:
              profile.sourceType === 'linkedin_profile' ? 45
                : profile.sourceType === 'company_team_page' ? 46
                  : profile.sourceType === 'company_about_page' ? 47
                    : 49,
            source: 'google_custom_search',
            sourceStage:
              profile.sourceType === 'linkedin_profile' ? 'D2'
                : profile.sourceType === 'company_team_page' || profile.sourceType === 'company_about_page'
                  ? 'D1'
                  : 'D2',
            matchedSignals: profile.matchSignals,
            confidence: profile.relevanceScore,
            verificationVerdict: 'skipped',
            supportingUrls: [profile.sourceUrl],
            rawJson: {
              matchType: 'google_cse_discovery',
              sourceType: profile.sourceType,
              sourceUrl: profile.sourceUrl,
              sourceDomain: profile.sourceDomain,
            },
          });
        }
        recoveryTelemetry.cseDiscoverSucceeded = addedCandidates > 0;
      }

      recoveryAttempts.push({
        stage: 'contact_recovery',
        provider: 'GOOGLE_CUSTOM_SEARCH',
        mode: 'discover',
        status: addedCandidates > 0 ? 'success' : 'empty',
        resultCount: discoverResult.status === 'success'
          ? discoverResult.diagnostics.reduce((sum, diagnostic) => sum + diagnostic.rawResultCount, 0)
          : 0,
        notes: addedCandidates > 0
          ? [
              `Added ${addedCandidates} validated candidate${addedCandidates === 1 ? '' : 's'} from ${discoverResult.status === 'success' ? discoverResult.topSourceFamily.replace('_', ' ') : 'google search'}`,
            ]
          : ['No new validated decision-makers were discovered'],
      });
    } else {
      recoveryAttempts.push({
        stage: 'contact_recovery',
        provider: 'GOOGLE_CUSTOM_SEARCH',
        mode: 'discover',
        status: 'skipped',
        resultCount: 0,
        notes: ['Skipped broader discovery because a strong candidate already existed'],
      });
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

  // ── 6. Select highest-authority contact as Lead (B3 — improved priority) ──
  // Sort: seniority (executive=0, director=1, manager=2, other=3), then positionRank (lower=better)
  // High-authority contacts (CEO, Director, Founder) are preferred even without email
  const sortedCandidates = [...allCandidates].sort((a, b) => {
    const senDiff = seniorityRank(a.seniority) - seniorityRank(b.seniority);
    if (senDiff !== 0) return senDiff;
    const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (confDiff !== 0) return confDiff;
    return a.positionRank - b.positionRank;
  });

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
      const inferred = await inferEmailPattern(
        knownEmails,
        domain,
        [{ name: candidate.name, title: candidate.title, seniority: candidate.seniority }],
        deps.smtpVerifier?.isConfigured ? deps.smtpVerifier : undefined,
      );

      if (inferred.length > 0) {
        if (isJunkPersonalEmail(inferred[0]!.email)) {
          continue;
        }
        candidate.email = inferred[0]!.email;
        inferredEmailCount += 1;
        if (candidate.source === 'google_custom_search') {
          recoveryTelemetry.cseEmailsInferred += 1;
        }
        logger.info(
          { ...logCtx, email: candidate.email, candidate: candidate.name, pattern: inferred[0]!.pattern },
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
  const cseTopCandidates = sortedCandidates
    .filter((candidate) => candidate.source === 'google_custom_search')
    .slice(0, 3)
    .map((candidate) => ({
      name: candidate.name,
      title: candidate.title,
      sourceStage: candidate.sourceStage ?? null,
      linkedinUrl: candidate.linkedinUrl,
      email: candidate.email,
      confidence: candidate.confidence ?? null,
      matchedSignals: candidate.matchedSignals ?? [],
      verificationVerdict: candidate.verificationVerdict ?? 'skipped',
      supportingUrls: dedupeUrls(candidate.supportingUrls ?? []),
    }));

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

  // ── 6f. Fallback: use generic/Instagram email for drafted leads ────────
  // Instead of fully disqualifying, create a 'drafted' lead routed to Business Intel
  let isDraftedLead = false;
  if (!contactEmail && businessEmailField) {
    contactEmail = businessEmailField;
    businessEmailField = null; // Promoted to primary — no longer secondary
    isDraftedLead = true;
    logger.info(
      { ...logCtx, fallbackEmail: contactEmail },
      'No personal email — using generic email for drafted lead (Business Intel)',
    );
  }

  // Populate gate stats before outcome decision
  gateStats.totalCandidates = allCandidates.length;
  gateStats.withEmail = allCandidates.filter((c) => c.email !== null).length;

  // ── 6g. No email at all → open recovery queue item ────────────────────
  if (!contactEmail) {
    const recoveryReason = resolvedContact ? 'NO_EMAIL' : 'NO_CONTACTS_FOUND';
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
          sourceStage: candidate.sourceStage,
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
    });

    await upsertContactRecoveryItem({
      businessId,
      icpProfileId,
      discoveryRunId,
      reason: recoveryReason,
      snapshot: recoverySnapshot,
    });

    gateStats.outcome = 'recovery';
    logger.warn(
      { ...logCtx, reason: recoveryReason, candidateCount: allCandidates.length, gateStats },
      'No email found at all — opened contact recovery item',
    );
    await prisma.business.update({
      where: { id: businessId },
      data: { preQualified: false, disqualificationReason: recoveryReason },
    });
    await persistCostEvents(prisma, discoveryRunId, businessId, costEvents);
    await tryFinalizeDiscoveryRun(discoveryRunId, logger);
    return;
  }

  const leadEmail = contactEmail;

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
    // Check for existing lead with same email (dedup)
    const existingLead = await tx.lead.findFirst({
      where: { email: leadEmail },
      select: { id: true },
    });

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
            : Prisma.JsonNull,
          hunterContactJson: hunterContactJson
            ? toInputJson(hunterContactJson)
            : Prisma.JsonNull,
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
                },
                contactProvenance: allCandidates.slice(0, 5).map((c) => ({
                  name: c.name,
                  source: c.source,
                  sourceStage: c.sourceStage ?? null,
                  confidence: c.confidence ?? null,
                  matchedSignals: c.matchedSignals ?? [],
                  verificationVerdict: c.verificationVerdict ?? 'skipped',
                  supportingUrls: dedupeUrls(c.supportingUrls ?? []),
                  hasEmail: c.email !== null,
                  hasLinkedin: c.linkedinUrl !== null,
                })),
              }),
              ...(businessInsights !== null ? { businessInsights } : {}),
            },
          }).catch((err: unknown) => {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
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
            ...(c.title !== null ? { title: c.title } : {}),
            ...(c.email !== null ? { email: c.email } : {}),
            ...(c.phone !== null ? { phone: c.phone } : {}),
            ...(c.linkedinUrl !== null ? { linkedinUrl: c.linkedinUrl } : {}),
            seniority: c.seniority,
            positionRank: c.positionRank,
            source: c.source,
          })),
          skipDuplicates: true,
        });
      }

      // Record cost events
      await persistCostEvents(tx as unknown as typeof prisma, discoveryRunId, businessId, costEvents);

      return { lead: existingLead, isNew: false };
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
          : Prisma.JsonNull,
        hunterContactJson: hunterContactJson
          ? toInputJson(hunterContactJson)
          : Prisma.JsonNull,
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
          },
          contactProvenance: allCandidates.slice(0, 5).map((c) => ({
            name: c.name,
            source: c.source,
            sourceStage: c.sourceStage ?? null,
            confidence: c.confidence ?? null,
            matchedSignals: c.matchedSignals ?? [],
            verificationVerdict: c.verificationVerdict ?? 'skipped',
            supportingUrls: dedupeUrls(c.supportingUrls ?? []),
            hasEmail: c.email !== null,
            hasLinkedin: c.linkedinUrl !== null,
          })),
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
          ...(c.title !== null ? { title: c.title } : {}),
          ...(c.email !== null ? { email: c.email } : {}),
          ...(c.phone !== null ? { phone: c.phone } : {}),
          ...(c.linkedinUrl !== null ? { linkedinUrl: c.linkedinUrl } : {}),
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

  // Persist canonical pipeline lineage records used by feature/scoring analytics.
  if (evidence?.searchTask) {
    const provider = resolveDiscoveryProvider(evidence.searchTask.paramsJson as Prisma.JsonValue | null);
    const providerRecordId = evidence.serpapiResultId ?? evidence.id;
    await prisma.leadDiscoveryRecord.upsert({
      where: {
        leadId_icpProfileId_provider_providerRecordId: {
          leadId: txResult.lead.id,
          icpProfileId,
          provider,
          providerRecordId,
        },
      },
      create: {
        leadId: txResult.lead.id,
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
    const requestKey = `hunter:convert:${txResult.lead.id}:${icpProfileId}:${discoveryRunId}`;
    await prisma.leadEnrichmentRecord.upsert({
      where: { requestKey },
      create: {
        leadId: txResult.lead.id,
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

  // ── 9. Enqueue features.compute if lead is newly created and NOT auto-rejected ─
  if (txResult.isNew && !shouldAutoReject && !isDraftedLead && deps.enqueueFeaturesCompute) {
    await deps.enqueueFeaturesCompute({
      runId: discoveryRunId,
      leadId: txResult.lead.id,
      icpProfileId,
      snapshotVersion: 1,
      correlationId: effectiveCorrelationId,
    });

    logger.info(
      { ...logCtx, leadId: txResult.lead.id },
      'Enqueued features.compute for newly created lead',
    );
  }

  // ── 10. Completion log ────────────────────────────────────────────────
  gateStats.outcome = isDraftedLead ? 'drafted' : 'lead_created';
  logger.info(
    {
      ...logCtx,
      leadId: txResult.lead.id,
      isNewLead: txResult.isNew,
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
