import { Prisma, prisma, toInputJson } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { RetryableError } from '../errors.js';

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

function isGenericEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase();
  if (!prefix) return true;
  return GENERIC_EMAIL_PREFIXES.has(prefix);
}

/**
 * Determine if a phone number is a generic business line (not a DM's personal line).
 * - If associated with a named person (from team page scrape), it's personal → false
 * - If from a /contact page with no person context, it's a business line → true
 * - If it's the only phone and business is small (≤2 employees), likely owner → false
 */
function isGenericPhone(
  phone: string,
  hasPersonContext: boolean,
  estimatedEmployees: number | null,
  pageUrl: string | null,
): boolean {
  // Phone associated with a named decision maker = personal
  if (hasPersonContext) return false;

  // Small business (≤2 employees) — only phone is likely the owner's
  if (estimatedEmployees !== null && estimatedEmployees <= 2) return false;

  // Phone from /contact or /contact-us page with no person context = business line
  if (pageUrl) {
    const path = pageUrl.toLowerCase();
    if (path.includes('/contact')) return true;
  }

  // Default: if no person context, assume business line
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
    return;
  }

  // ── 2. Require websiteDomain ──────────────────────────────────────────
  if (!business.websiteDomain) {
    logger.warn(
      { ...logCtx, reason: 'NO_DOMAIN' },
      'Business has no website domain — cannot find contacts, skipping',
    );
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
    source: 'website_scrape' | 'instagram' | 'hunter' | 'apollo';
    rawJson: unknown;
  }

  const allCandidates: ContactCandidate[] = [];
  let apolloContactJson: unknown = null;
  let hunterContactJson: unknown = null;
  const costEvents: Array<{ provider: 'APOLLO' | 'HUNTER' | 'SERPAPI'; costCents: number; apiCallType: string }> = [];
  const estimatedEmployees = websiteScrapeData?.businessSignals?.estimatedEmployeeCount ?? null;

  // 5a. Website scrape decision makers (max 5, already ranked by positionRank)
  if (websiteScrapeData?.decisionMakers && websiteScrapeData.decisionMakers.length > 0) {
    for (const dm of websiteScrapeData.decisionMakers) {
      // Filter generic emails
      const email = dm.email && !isGenericEmail(dm.email) ? dm.email : null;
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
  if (instagramData?.businessEmail && !isGenericEmail(instagramData.businessEmail)) {
    let igEmailValid = true;
    if (deps.smtpVerifier?.isConfigured) {
      const verification = await deps.smtpVerifier.verify(instagramData.businessEmail);
      if (verification.status !== 'valid' && verification.status !== 'catch_all') {
        igEmailValid = false;
      }
    }
    allCandidates.push({
      name: business.name,
      title: null,
      email: igEmailValid ? instagramData.businessEmail : null,
      phone: instagramData.businessPhone ?? null,
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
      if (isGenericEmail(rawEmail)) continue;
      if (assignedEmails.has(rawEmail.toLowerCase())) continue;

      const match = matchEmailToDecisionMaker(rawEmail, dms);
      if (match && match.confidence === 'HIGH') {
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
          if (isGenericEmail(rawEmail)) continue;
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

    // Hunter (cheaper)
    if (deps.hunterAdapter.isConfigured) {
      const hunterResult = await deps.hunterAdapter.searchDomainContacts(domain);
      if (hunterResult.status === 'success' && hunterResult.contacts.length > 0) {
        hunterContactJson = hunterResult.contacts;
        for (const hc of hunterResult.contacts) {
          if (isGenericEmail(hc.email)) continue;

          // Skip emails Hunter marks as invalid
          if (hc.verification === 'invalid') {
            logger.info(
              { ...logCtx, email: hc.email, hunterVerification: hc.verification },
              'Skipping Hunter contact — marked invalid by Hunter',
            );
            continue;
          }

          // Skip low-confidence emails (likely pattern-guessed, unverified)
          if (hc.confidence !== null && hc.confidence < 70) {
            logger.info(
              { ...logCtx, email: hc.email, hunterConfidence: hc.confidence },
              'Skipping Hunter contact — confidence below 70',
            );
            continue;
          }

          // Trust Hunter's own verification — only SMTP-verify if Hunter didn't verify
          if (hc.verification !== 'valid' && deps.smtpVerifier?.isConfigured) {
            const smtpResult = await deps.smtpVerifier.verify(hc.email);
            if (smtpResult.status !== 'valid' && smtpResult.status !== 'catch_all') {
              logger.info(
                { ...logCtx, email: hc.email, smtpStatus: smtpResult.status, hunterVerification: hc.verification },
                'Hunter contact failed SMTP verification',
              );
              continue;
            }
          }

          allCandidates.push({
            name: [hc.firstName ?? '', hc.lastName ?? ''].filter(Boolean).join(' ') || business.name,
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
    }

    // Apollo (more expensive — only if pre-screen says email exists)
    const hasEmailAfterHunter = allCandidates.some((c) => c.email !== null);
    if (!hasEmailAfterHunter && deps.apolloAdapter.isConfigured && apolloHasEmail) {
      const apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);
      if (apolloResult.status === 'success' && apolloResult.contacts.length > 0) {
        for (const ac of apolloResult.contacts) {
          if (isGenericEmail(ac.email)) continue;

          // SMTP verify Apollo email if verifier is available
          if (deps.smtpVerifier?.isConfigured) {
            const smtpResult = await deps.smtpVerifier.verify(ac.email);
            if (smtpResult.status !== 'valid' && smtpResult.status !== 'catch_all') {
              logger.info(
                { ...logCtx, email: ac.email, smtpStatus: smtpResult.status },
                'Apollo contact failed SMTP verification',
              );
              continue;
            }
          }

          apolloContactJson = ac;
          allCandidates.push({
            name: [ac.firstName, ac.lastName].filter(Boolean).join(' ') || business.name,
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
    }
  } else {
    logger.info(
      { ...logCtx, candidateCount: allCandidates.length },
      'Valid email found from scrape data — skipping paid providers',
    );
  }

  // ── 6. Select highest-authority contact as Lead ─────────────────────────
  // Sort: seniority (executive=0, director=1, manager=2, other=3), then positionRank (lower=better)
  // Only candidates with a valid (non-generic) email can become the lead
  const leadCandidates = [...allCandidates]
    .filter((c) => c.email !== null)
    .sort((a, b) => {
      const senDiff = seniorityRank(a.seniority) - seniorityRank(b.seniority);
      if (senDiff !== 0) return senDiff;
      return a.positionRank - b.positionRank;
    });

  const resolvedContact = leadCandidates[0] ?? null;

  // 6c. Both paid providers retryable → throw to trigger pg-boss retry
  if (!resolvedContact && hunterRetryable && apolloRetryable) {
    throw new RetryableError(
      `Both Hunter and Apollo returned retryable errors for domain ${domain}`,
    );
  }

  // 6d. No contact from any source → terminal, can't create lead
  if (!resolvedContact) {
    logger.warn(
      { ...logCtx, reason: 'NO_CONTACTS_FOUND', candidateCount: allCandidates.length },
      'No decision-maker contacts with valid email found — cannot create lead',
    );
    return;
  }

  // ── 7. Derive lead source from actual provider ───────────────────────────
  let leadSource = 'SERPAPI_DISCOVERY';
  const evidence = await prisma.businessEvidence.findFirst({
    where: { businessId },
    select: { sourceType: true },
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
  const contactEmail = resolvedContact.email!;
  const { firstName: resolvedFirstName, lastName: resolvedLastName } = parseName(resolvedContact.name);

  const txResult = await prisma.$transaction(async (tx) => {
    // Check for existing lead with same email (dedup)
    const existingLead = await tx.lead.findFirst({
      where: { email: contactEmail },
      select: { id: true },
    });

    if (existingLead) {
      logger.info(
        { ...logCtx, existingLeadId: existingLead.id, email: contactEmail },
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

      // Create BusinessContact rows even for existing leads
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
      for (const ce of costEvents) {
        await tx.discoveryCostEvent.create({
          data: {
            discoveryRunId,
            provider: ce.provider,
            costCents: ce.costCents,
            apiCallType: ce.apiCallType,
            businessId,
          },
        });
      }

      return { lead: existingLead, isNew: false };
    }

    // Determine first/last name — use contact data, fallback to business name
    const firstName = resolvedFirstName || business.name;
    const lastName = resolvedLastName || '';

    const lead = await tx.lead.create({
      data: {
        firstName,
        lastName,
        email: contactEmail,
        phone: resolvedContact.phone ?? null,
        businessId: business.id,
        decisionMakerTitle: resolvedContact.title ?? null,
        decisionMakerPhone: resolvedContact.phone ?? null,
        source: leadSource,
        status: 'new',
      },
    });

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
        metadata: toInputJson({ contactSource: resolvedContact.source }),
        ...(businessInsights !== null ? { businessInsights } : {}),
      },
    });

    // Create BusinessContact rows for all scraped contacts (max 5)
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
    for (const ce of costEvents) {
      await tx.discoveryCostEvent.create({
        data: {
          discoveryRunId,
          provider: ce.provider,
          costCents: ce.costCents,
          apiCallType: ce.apiCallType,
          businessId,
        },
      });
    }

    return { lead, isNew: true };
  });

  // ── 9. Enqueue features.compute if lead is newly created ────────────────
  if (txResult.isNew && deps.enqueueFeaturesCompute) {
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
  logger.info(
    {
      ...logCtx,
      leadId: txResult.lead.id,
      isNewLead: txResult.isNew,
      contactSource: resolvedContact.source,
      businessContactCount: Math.min(allCandidates.length, 5),
      paidProvidersCalled: costEvents.length,
      leadSource,
    },
    'Completed business.convert job',
  );
}
