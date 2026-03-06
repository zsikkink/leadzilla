import { prisma } from '@lead-flood/db';
import { promises as dns } from 'node:dns';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';

export const BUSINESS_PREQUALIFY_JOB_NAME = 'business.prequalify';

export const BUSINESS_PREQUALIFY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: 'business.prequalify.dead_letter',
};

/** Default minimum review count for pre-qualification. */
const DEFAULT_MIN_REVIEW_COUNT = 15;

/** Keywords that indicate a parked/for-sale domain. */
const PARKED_DOMAIN_KEYWORDS = [
  'domain is for sale',
  'buy this domain',
  'this domain is available',
  'domain for sale',
  'domain parking',
  'parked domain',
  'this domain may be for sale',
  'hugedomains',
  'godaddy',
  'sedo.com',
  'dan.com',
  'afternic',
  'undeveloped.com',
  'domainmarket.com',
  'register this domain',
  'domain has expired',
  'this site is under construction',
  'coming soon',
];

export interface BusinessPrequalifyJobPayload {
  businessId: string;
  discoveryRunId: string;
  icpProfileId: string;
  minReviewCount?: number | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  correlationId?: string | undefined;
}

export interface BusinessPrequalifyJobDependencies {
  enqueueBusinessConvert?: ((payload: {
    businessId: string;
    discoveryRunId: string;
    icpProfileId: string;
    includeWebsiteAnalysis?: boolean | undefined;
    includeSocialMediaAnalysis?: boolean | undefined;
    correlationId?: string | undefined;
  }) => Promise<void>) | undefined;
}

export interface BusinessPrequalifyLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

// ── DNS resolution check ──────────────────────────────────────────────

async function domainResolves(domain: string): Promise<boolean> {
  try {
    // Try A records first, then AAAA
    const records = await dns.resolve4(domain).catch(() => null);
    if (records && records.length > 0) return true;
    const records6 = await dns.resolve6(domain).catch(() => null);
    return Boolean(records6 && records6.length > 0);
  } catch {
    return false;
  }
}

// ── Parked domain detection ───────────────────────────────────────────

async function isParkedDomain(domain: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`https://${domain}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LeadFlood/1.0)',
      },
      redirect: 'follow',
    });

    clearTimeout(timer);

    // If we get a redirect to a domain registrar, it's likely parked
    const finalUrl = response.url.toLowerCase();
    if (
      finalUrl.includes('godaddy.com') ||
      finalUrl.includes('sedo.com') ||
      finalUrl.includes('dan.com') ||
      finalUrl.includes('hugedomains.com') ||
      finalUrl.includes('afternic.com')
    ) {
      return true;
    }

    const text = await response.text();
    const textLower = text.toLowerCase();

    // Short pages with parking keywords are likely parked
    // Only check if the page is relatively short (real sites have more content)
    if (text.length < 5000) {
      return PARKED_DOMAIN_KEYWORDS.some((kw) => textLower.includes(kw));
    }

    return false;
  } catch {
    // Network errors are not parked domain indicators — domain might be temporarily down
    return false;
  }
}

// ── ICP industry match ────────────────────────────────────────────────

/**
 * Check if a business's SerpAPI category matches any of the ICP's target industries.
 * Uses fuzzy matching: splits both the business category and ICP industries into tokens
 * and checks for overlapping words.
 */
function matchesIcpIndustry(
  businessCategory: string | null,
  targetIndustries: string[],
): boolean {
  // If no target industries are set, all businesses match (no filter)
  if (targetIndustries.length === 0) return true;
  // If we don't know the business category, don't disqualify (let it through)
  if (!businessCategory) return true;

  const bizTokens = new Set(
    businessCategory
      .toLowerCase()
      .split(/[\s,_\-/&]+/)
      .filter((t) => t.length > 2),
  );

  // Check each ICP industry for token overlap with business category
  for (const industry of targetIndustries) {
    const industryTokens = industry
      .toLowerCase()
      .split(/[\s,_\-/&]+/)
      .filter((t) => t.length > 2);

    for (const token of industryTokens) {
      if (bizTokens.has(token)) return true;
    }
  }

  return false;
}

// ── Handler ───────────────────────────────────────────────────────────

export async function handleBusinessPrequalifyJob(
  logger: BusinessPrequalifyLogger,
  job: Job<BusinessPrequalifyJobPayload>,
  deps?: BusinessPrequalifyJobDependencies,
): Promise<void> {
  const {
    businessId,
    discoveryRunId,
    icpProfileId,
    minReviewCount,
    includeWebsiteAnalysis,
    includeSocialMediaAnalysis,
    correlationId,
  } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;
  const effectiveMinReviewCount = minReviewCount ?? DEFAULT_MIN_REVIEW_COUNT;

  const logCtx = {
    jobId: job.id,
    queue: job.name,
    businessId,
    discoveryRunId,
    icpProfileId,
    correlationId: effectiveCorrelationId,
  };

  logger.info(
    { ...logCtx, minReviewCount: effectiveMinReviewCount },
    'Started business.prequalify job',
  );

  try {
  // ── Load business ──────────────────────────────────────────────────
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business) {
    logger.warn(logCtx, 'Business not found — skipping pre-qualification');
    return;
  }

  // ── Check: website domain ──────────────────────────────────────────
  if (!business.websiteDomain) {
    await disqualify(businessId, discoveryRunId, 'NO_WEBSITE_DOMAIN', logCtx, logger);
    return;
  }

  // ── Check: minimum review count ────────────────────────────────────
  const reviewCount = business.reviewCount ?? 0;
  if (reviewCount < effectiveMinReviewCount) {
    await disqualify(businessId, discoveryRunId, 'INSUFFICIENT_REVIEWS', logCtx, logger, {
      reviewCount,
      minReviewCount: effectiveMinReviewCount,
    });
    return;
  }

  // ── Check: DNS resolution ──────────────────────────────────────────
  const resolves = await domainResolves(business.websiteDomain);
  if (!resolves) {
    await disqualify(businessId, discoveryRunId, 'DOMAIN_NOT_RESOLVING', logCtx, logger, {
      domain: business.websiteDomain,
    });
    return;
  }

  // ── Check: parked domain ───────────────────────────────────────────
  const parked = await isParkedDomain(business.websiteDomain);
  if (parked) {
    await disqualify(businessId, discoveryRunId, 'PARKED_DOMAIN', logCtx, logger, {
      domain: business.websiteDomain,
    });
    return;
  }

  // ── Check: ICP industry match ──────────────────────────────────────
  const icpProfile = await prisma.icpProfile.findUnique({
    where: { id: icpProfileId },
    select: { targetIndustries: true },
  });

  if (icpProfile && !matchesIcpIndustry(business.category, icpProfile.targetIndustries)) {
    await disqualify(businessId, discoveryRunId, 'ICP_INDUSTRY_MISMATCH', logCtx, logger, {
      businessCategory: business.category,
      targetIndustries: icpProfile.targetIndustries,
    });
    return;
  }

  // ── Pre-qualification passed ───────────────────────────────────────
  await prisma.business.update({
    where: { id: businessId },
    data: {
      preQualified: true,
      disqualificationReason: null,
    },
  });

  await recordCostEvent(discoveryRunId, businessId);

  // ── Enqueue business.convert if dependency provided ────────────────
  if (deps?.enqueueBusinessConvert) {
    await deps.enqueueBusinessConvert({
      businessId,
      discoveryRunId,
      icpProfileId,
      includeWebsiteAnalysis,
      includeSocialMediaAnalysis,
      correlationId: effectiveCorrelationId,
    });

    logger.info(logCtx, 'Enqueued business.convert for pre-qualified business');
  }

  logger.info(
    { ...logCtx, reviewCount },
    'Completed business.prequalify job — business qualified',
  );
  } catch (error: unknown) {
    logger.error({ ...logCtx, error }, 'Failed business.prequalify job');
    throw classifyError(error);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

async function disqualify(
  businessId: string,
  discoveryRunId: string,
  reason: string,
  logCtx: Record<string, unknown>,
  logger: BusinessPrequalifyLogger,
  extra?: Record<string, unknown>,
): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: {
      preQualified: false,
      disqualificationReason: reason,
    },
  });

  await recordCostEvent(discoveryRunId, businessId);

  logger.info(
    { ...logCtx, reason, ...extra },
    `Business disqualified — ${reason}`,
  );

  // Check if this was the last pending item for the discovery run
  await tryFinalizeDiscoveryRun(discoveryRunId, logger);
}

async function recordCostEvent(
  discoveryRunId: string,
  businessId: string,
): Promise<void> {
  await prisma.discoveryCostEvent.create({
    data: {
      discoveryRunId,
      provider: 'SERPAPI',
      costCents: 0,
      apiCallType: 'prequalify_check',
      businessId,
    },
  });
}
