import { createHash } from 'node:crypto';
import { prisma, toInputJson } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';

import {
  SCORING_COMPUTE_JOB_NAME,
  SCORING_COMPUTE_RETRY_OPTIONS,
  type ScoringComputeJobPayload,
} from './scoring.compute.job.js';
import { evaluateDeterministicScore } from '../scoring/deterministic.js';
import { asDeterministicRules } from '../scoring/shared.js';
import { computePopulationRates, detectFeatureDrift } from '../utils/feature-drift.js';

export const FEATURES_COMPUTE_JOB_NAME = 'features.compute';
export const FEATURES_COMPUTE_IDEMPOTENCY_KEY_PATTERN = 'features.compute:${leadId}:${snapshotVersion}';

export const FEATURES_COMPUTE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 20,
  retryBackoff: true,
  deadLetter: 'features.compute.dead_letter',
};

export interface FeaturesComputeJobPayload {
  runId: string;
  leadId: string;
  icpProfileId: string;
  snapshotVersion: number;
  sourceVersion?: string;
  enrichmentRecordId?: string;
  correlationId?: string;
}

export interface FeaturesComputeLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface FeaturesComputeDependencies {
  boss: Pick<PgBoss, 'send'>;
  enqueueScoring?: boolean;
}

export const FEATURE_EXTRACTOR_VERSION = 'features_v2';
export const DRIFT_DETECTION_MIN_BATCH_SIZE = 5;
export const DRIFT_DETECTION_THRESHOLD = 0.3;
export const FEATURE_KEYS = [
  'source_provider',
  'has_email',
  'has_domain',
  'has_company_name',
  'country',
  'industry',
  'industry_supported',
  'has_whatsapp',
  'has_instagram',
  'accepts_online_payments',
  'review_count',
  'follower_count',
  'physical_address_present',
  'recent_activity',
  'custom_order_signals',
  'pure_self_serve_ecom',
  'shopify_detected',
  'multi_staff_detected',
  'follower_growth_signal',
  'high_engagement_signal',
  'has_booking_or_contact_form',
  'variable_pricing_detected',
  'industry_match',
  'industry_match_reason',
  'geo_match',
  'geo_match_reason',
  'employee_size_bucket',
  'high_ticket_signals',
  'deposit_milestone_signals',
  'subscription_billing_detected',
  'international_customer_signals',
  'icp_segment_priority',
  'review_count_tier',
  'follower_count_tier',
  'seasonal_signals',
  'bank_transfer_reliance',
  'upsell_signals',
  'price_led_mindset',
  // ── v2 features (Apify + Instagram + Apollo) ──
  'apify_payment_widget_count',
  'apify_has_shopify',
  'apify_has_booking_form',
  'apify_has_pricing_tiers',
  'apify_has_product_catalog',
  'apify_platform',
  'instagram_follower_count',
  'instagram_engagement_rate',
  'instagram_is_business_account',
  'instagram_days_since_last_post',
  'instagram_has_bio_link',
  'has_decision_maker_phone',
  'decision_maker_seniority',
  'contact_source',
  // ── v2.1 features (enhanced scrapers) ──
  'decision_maker_count',
  'apollo_has_direct_phone',
  'website_email_count',
  'website_phone_count',
  'social_link_count',
  'has_linkedin',
  'tech_stack_size',
  'has_crm',
  'has_live_chat',
  'has_analytics',
  'estimated_employees',
  'certification_count',
  'instagram_business_category',
  'instagram_has_business_email',
  // ── v3 features (data alignment) ──
  'data_alignment_score',
] as const;

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeCountry(value: unknown): string | null {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }

  if (['uae', 'ae', 'united arab emirates'].includes(normalized)) {
    return 'UAE';
  }
  if (['ksa', 'saudi arabia', 'sa'].includes(normalized)) {
    return 'KSA';
  }
  if (['jordan', 'jo'].includes(normalized)) {
    return 'Jordan';
  }
  if (['egypt', 'eg'].includes(normalized)) {
    return 'Egypt';
  }

  return normalized.toUpperCase();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value > 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) {
      return true;
    }
    if (['false', 'no', 'n', '0'].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function findValueByKey(input: unknown, targetKey: string): unknown {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const entries = Object.entries(input as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (key === targetKey) {
      return value;
    }
  }

  for (const [, value] of entries) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = findValueByKey(item, targetKey);
        if (nested !== undefined) {
          return nested;
        }
      }
      continue;
    }

    if (value && typeof value === 'object') {
      const nested = findValueByKey(value, targetKey);
      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

function extractNumberFromSources(
  sources: unknown[],
  candidateKeys: readonly string[],
): number | null {
  for (const source of sources) {
    for (const key of candidateKeys) {
      const value = findValueByKey(source, key);
      const numeric = asNumber(value);
      if (numeric !== null) {
        return numeric;
      }
    }
  }
  return null;
}

function extractBooleanFromSources(
  sources: unknown[],
  candidateKeys: readonly string[],
): boolean | null {
  for (const source of sources) {
    for (const key of candidateKeys) {
      const value = findValueByKey(source, key);
      const bool = asBoolean(value);
      if (bool !== null) {
        return bool;
      }
    }
  }
  return null;
}

function includesAnyKeyword(value: unknown, keywords: readonly string[]): boolean {
  const text = stableStringify(value).toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSort(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const sortedEntries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entryValue]) => [key, stableSort(entryValue)]);

  return Object.fromEntries(sortedEntries);
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableSort(value));
}

export function computeFeatureVectorHash(features: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(features)).digest('hex');
}

export function toEmployeeSizeBucket(companySize: number | null): string {
  if (companySize === null || !Number.isFinite(companySize)) {
    return 'unknown';
  }
  if (companySize <= 10) {
    return 'micro';
  }
  if (companySize <= 50) {
    return 'small';
  }
  if (companySize <= 250) {
    return 'medium';
  }
  if (companySize <= 1000) {
    return 'large';
  }
  return 'enterprise';
}

function buildFeaturePayload(input: {
  sourceProvider: string;
  hasEmail: boolean;
  hasDomain: boolean;
  hasCompanyName: boolean;
  country: string | null;
  industry: string | null;
  industrySupported: boolean;
  hasWhatsapp: boolean;
  hasInstagram: boolean;
  acceptsOnlinePayments: boolean;
  reviewCount: number;
  followerCount: number;
  physicalAddressPresent: boolean;
  recentActivity: boolean;
  customOrderSignals: boolean;
  pureSelfServeEcom: boolean;
  shopifyDetected: boolean;
  multiStaffDetected: boolean;
  followerGrowthSignal: boolean;
  highEngagementSignal: boolean;
  hasBookingOrContactForm: boolean;
  variablePricingDetected: boolean;
  industryMatch: boolean;
  industryMatchReason: string;
  geoMatch: boolean;
  geoMatchReason: string;
  employeeSizeBucket: string;
  highTicketSignals: boolean;
  depositMilestoneSignals: boolean;
  subscriptionBillingDetected: boolean;
  internationalCustomerSignals: boolean;
  icpSegmentPriority: number;
  reviewCountTier: number;
  followerCountTier: number;
  seasonalSignals: boolean;
  bankTransferReliance: boolean;
  upsellSignals: boolean;
  priceLedMindset: boolean;
  // v2 features
  apifyPaymentWidgetCount: number;
  apifyHasShopify: boolean;
  apifyHasBookingForm: boolean;
  apifyHasPricingTiers: boolean;
  apifyHasProductCatalog: boolean;
  apifyPlatform: string;
  instagramFollowerCount: number;
  instagramEngagementRate: number;
  instagramIsBusinessAccount: boolean;
  instagramDaysSinceLastPost: number;
  instagramHasBioLink: boolean;
  hasDecisionMakerPhone: boolean;
  decisionMakerSeniority: string;
  contactSource: string;
  // v2.1 features (enhanced scrapers)
  decisionMakerCount: number;
  apolloHasDirectPhone: boolean;
  websiteEmailCount: number;
  websitePhoneCount: number;
  socialLinkCount: number;
  hasLinkedIn: boolean;
  techStackSize: number;
  hasCrm: boolean;
  hasLiveChat: boolean;
  hasAnalytics: boolean;
  estimatedEmployees: number;
  certificationCount: number;
  instagramBusinessCategory: string;
  instagramHasBusinessEmail: boolean;
  // v3 features (data alignment)
  dataAlignmentScore: number;
}): Record<(typeof FEATURE_KEYS)[number], unknown> {
  return {
    source_provider: input.sourceProvider,
    has_email: input.hasEmail,
    has_domain: input.hasDomain,
    has_company_name: input.hasCompanyName,
    country: input.country,
    industry: input.industry,
    industry_supported: input.industrySupported,
    has_whatsapp: input.hasWhatsapp,
    has_instagram: input.hasInstagram,
    accepts_online_payments: input.acceptsOnlinePayments,
    review_count: input.reviewCount,
    follower_count: input.followerCount,
    physical_address_present: input.physicalAddressPresent,
    recent_activity: input.recentActivity,
    custom_order_signals: input.customOrderSignals,
    pure_self_serve_ecom: input.pureSelfServeEcom,
    shopify_detected: input.shopifyDetected,
    multi_staff_detected: input.multiStaffDetected,
    follower_growth_signal: input.followerGrowthSignal,
    high_engagement_signal: input.highEngagementSignal,
    has_booking_or_contact_form: input.hasBookingOrContactForm,
    variable_pricing_detected: input.variablePricingDetected,
    industry_match: input.industryMatch,
    industry_match_reason: input.industryMatchReason,
    geo_match: input.geoMatch,
    geo_match_reason: input.geoMatchReason,
    employee_size_bucket: input.employeeSizeBucket,
    high_ticket_signals: input.highTicketSignals,
    deposit_milestone_signals: input.depositMilestoneSignals,
    subscription_billing_detected: input.subscriptionBillingDetected,
    international_customer_signals: input.internationalCustomerSignals,
    icp_segment_priority: input.icpSegmentPriority,
    review_count_tier: input.reviewCountTier,
    follower_count_tier: input.followerCountTier,
    seasonal_signals: input.seasonalSignals,
    bank_transfer_reliance: input.bankTransferReliance,
    upsell_signals: input.upsellSignals,
    price_led_mindset: input.priceLedMindset,
    // v2 features
    apify_payment_widget_count: input.apifyPaymentWidgetCount,
    apify_has_shopify: input.apifyHasShopify,
    apify_has_booking_form: input.apifyHasBookingForm,
    apify_has_pricing_tiers: input.apifyHasPricingTiers,
    apify_has_product_catalog: input.apifyHasProductCatalog,
    apify_platform: input.apifyPlatform,
    instagram_follower_count: input.instagramFollowerCount,
    instagram_engagement_rate: input.instagramEngagementRate,
    instagram_is_business_account: input.instagramIsBusinessAccount,
    instagram_days_since_last_post: input.instagramDaysSinceLastPost,
    instagram_has_bio_link: input.instagramHasBioLink,
    has_decision_maker_phone: input.hasDecisionMakerPhone,
    decision_maker_seniority: input.decisionMakerSeniority,
    contact_source: input.contactSource,
    // v2.1 features (enhanced scrapers)
    decision_maker_count: input.decisionMakerCount,
    apollo_has_direct_phone: input.apolloHasDirectPhone,
    website_email_count: input.websiteEmailCount,
    website_phone_count: input.websitePhoneCount,
    social_link_count: input.socialLinkCount,
    has_linkedin: input.hasLinkedIn,
    tech_stack_size: input.techStackSize,
    has_crm: input.hasCrm,
    has_live_chat: input.hasLiveChat,
    has_analytics: input.hasAnalytics,
    estimated_employees: input.estimatedEmployees,
    certification_count: input.certificationCount,
    instagram_business_category: input.instagramBusinessCategory,
    instagram_has_business_email: input.instagramHasBusinessEmail,
    // v3 features (data alignment)
    data_alignment_score: input.dataAlignmentScore,
  };
}

/** Classify review count into tiers: 0=none, 1=low, 2=medium, 3=high, 4=very_high */
function toReviewCountTier(count: number): number {
  if (count <= 0) return 0;
  if (count <= 10) return 1;
  if (count <= 50) return 2;
  if (count <= 200) return 3;
  return 4;
}

/** Classify follower count into tiers: 0=none, 1=low, 2=medium, 3=high, 4=very_high */
function toFollowerCountTier(count: number): number {
  if (count <= 0) return 0;
  if (count <= 500) return 1;
  if (count <= 5000) return 2;
  if (count <= 50000) return 3;
  return 4;
}

const P1_INDUSTRIES = new Set([
  'luxury', 'yacht', 'charter', 'concierge', 'personal shopping', 'stylist',
  'gifting', 'corporate gifting', 'bespoke', 'florist',
  'events', 'wedding', 'wedding planner', 'event production', 'exhibition', 'festival',
  'interior design', 'renovation', 'architecture', 'contracting', 'fit-out',
  'hospitality', 'hotel', 'boutique hotel', 'holiday home', 'serviced residence', 'property management',
]);

const P2_INDUSTRIES = new Set([
  'wellness', 'aesthetics', 'clinic', 'cosmetic', 'longevity', 'iv therapy',
  'coaching', 'consulting', 'advisory', 'membership', 'mastermind',
  'education', 'training', 'bootcamp', 'certification',
]);

function classifyIcpSegmentPriority(industry: string | null, targetIndustries: Set<string>): number {
  if (!industry) return 0;
  const lower = industry.toLowerCase();

  // Check P1 first
  for (const p1 of P1_INDUSTRIES) {
    if (lower.includes(p1)) return 2;
  }

  // Check P2
  for (const p2 of P2_INDUSTRIES) {
    if (lower.includes(p2)) return 1;
  }

  // Fall back to target industry match
  if (targetIndustries.size > 0 && targetIndustries.has(lower)) return 1;

  return 0;
}

// ── Data Alignment Score ─────────────────────────────────────────────────────
// Cross-source consistency checks to detect data mismatches across SerpAPI,
// website scrape, Instagram, and enrichment sources.

/**
 * Tokenize a string into lowercase alphanumeric words.
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1),
  );
}

/**
 * Dice coefficient: 2 * |intersection| / (|A| + |B|).
 * Returns 0-1, where 1 = perfect overlap, 0 = no overlap.
 */
function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1; // both empty = match
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

/**
 * Simple domain extraction from a URL string (strips www., protocol, path).
 */
function extractDomain(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]!
    .split(':')[0]!
    .toLowerCase()
    .trim();
}

/**
 * Compute a weighted cross-source data alignment score.
 *
 * Checks:
 *  1. Domain consistency: SerpAPI business name vs website <title> (weight: 0.30)
 *  2. Brand consistency: website domain vs Instagram username (weight: 0.25)
 *  3. Geographic consistency: SerpAPI/enrichment country vs website detected country (weight: 0.25)
 *  4. Contact consistency: decision maker email domain == business domain (weight: 0.20)
 *
 * Thresholds:
 *  - < 0.3: flag as hard filter (data sources likely describe different entities)
 *  - 0.3-0.5: low confidence, stored as weighted feature
 *  - > 0.5: proceed normally
 */
function computeDataAlignmentScore(params: {
  serpApiName: string | null;
  websiteTitle: string | null;
  websiteDomain: string | null;
  instagramUsername: string | null;
  serpApiCountry: string | null;
  websiteCountry: string | null;
  leadEmailDomain: string | null;
}): { score: number; checks: Record<string, number> } {
  const checks: Record<string, number> = {};
  let totalWeight = 0;
  let weightedSum = 0;

  // 1. Domain consistency: SerpAPI business name vs website <title> tag
  if (params.serpApiName && params.websiteTitle) {
    const serpTokens = tokenize(params.serpApiName);
    const titleTokens = tokenize(params.websiteTitle);
    checks.domain_consistency = diceCoefficient(serpTokens, titleTokens);
    weightedSum += checks.domain_consistency * 0.30;
    totalWeight += 0.30;
  }

  // 2. Brand consistency: website domain vs Instagram username
  if (params.websiteDomain && params.instagramUsername) {
    const domainBase = params.websiteDomain.split('.')[0]!.toLowerCase();
    const igUsername = params.instagramUsername.toLowerCase().replace(/[._-]/g, '');
    const domainClean = domainBase.replace(/[._-]/g, '');
    // Check substring containment (e.g., "dubailuxury" domain, "dubai_luxury_co" IG)
    const containsMatch = igUsername.includes(domainClean) || domainClean.includes(igUsername);
    const tokenMatch = diceCoefficient(tokenize(domainBase), tokenize(params.instagramUsername));
    checks.brand_consistency = containsMatch ? Math.max(0.8, tokenMatch) : tokenMatch;
    weightedSum += checks.brand_consistency * 0.25;
    totalWeight += 0.25;
  }

  // 3. Geographic consistency: SerpAPI/enrichment country vs website detected country
  if (params.serpApiCountry && params.websiteCountry) {
    const serpCountry = params.serpApiCountry.toLowerCase().trim();
    const webCountry = params.websiteCountry.toLowerCase().trim();
    checks.geo_consistency = serpCountry === webCountry ? 1.0 : 0.0;
    weightedSum += checks.geo_consistency * 0.25;
    totalWeight += 0.25;
  }

  // 4. Contact consistency: lead email domain == business website domain
  if (params.leadEmailDomain && params.websiteDomain) {
    const emailDomain = params.leadEmailDomain.toLowerCase();
    const siteDomain = params.websiteDomain.toLowerCase();
    // Exact match or subdomain match
    const match = emailDomain === siteDomain || emailDomain.endsWith(`.${siteDomain}`) || siteDomain.endsWith(`.${emailDomain}`);
    checks.contact_consistency = match ? 1.0 : 0.0;
    weightedSum += checks.contact_consistency * 0.20;
    totalWeight += 0.20;
  }

  // If no checks could be performed, return neutral score (0.5)
  if (totalWeight === 0) {
    return { score: 0.5, checks };
  }

  // Normalize by total contributing weight
  const score = Math.max(0, Math.min(1, weightedSum / totalWeight));
  return { score: Number(score.toFixed(4)), checks };
}

export async function handleFeaturesComputeJob(
  logger: FeaturesComputeLogger,
  job: Job<FeaturesComputeJobPayload>,
  dependencies: FeaturesComputeDependencies,
): Promise<void> {
  const { runId, correlationId, leadId, icpProfileId, snapshotVersion } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: effectiveCorrelationId,
      leadId,
      icpProfileId,
      snapshotVersion,
    },
    'Started features.compute job',
  );

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead || lead.deletedAt) {
      logger.warn(
        {
          jobId: job.id,
          runId,
          correlationId: effectiveCorrelationId,
          leadId,
          softDeleted: lead?.deletedAt ? true : undefined,
        },
        lead?.deletedAt ? 'Skipping soft-deleted lead' : 'Skipping features.compute job because lead was not found',
      );
      return;
    }

    const icp = await prisma.icpProfile.findUnique({
      where: { id: icpProfileId },
    });

    if (!icp) {
      logger.warn(
        {
          jobId: job.id,
          runId,
          correlationId: effectiveCorrelationId,
          leadId,
          icpProfileId,
        },
        'Skipping features.compute job because icpProfile was not found',
      );
      return;
    }

    const [latestDiscovery, latestEnrichment, rules] =
      await Promise.all([
        prisma.leadDiscoveryRecord.findFirst({
          where: {
            leadId,
            icpProfileId,
          },
          orderBy: [{ discoveredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
        prisma.leadEnrichmentRecord.findFirst({
          where: { leadId },
          orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        }),
        prisma.qualificationRule.findMany({
          where: {
            icpProfileId,
            isActive: true,
          },
          orderBy: [{ orderIndex: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);

    // ── Load Business + BusinessConversion for Apify/Apollo structured data ──
    const business = lead.businessId
      ? await prisma.business.findUnique({
          where: { id: lead.businessId },
          select: {
            name: true,
            websiteDomain: true,
            apifyWebsiteScrapeJson: true,
            apifyInstagramScrapeJson: true,
            websiteScrapedAt: true,
            instagramScrapedAt: true,
            countryCode: true,
            reviewCount: true,
            hasWhatsapp: true,
            hasInstagram: true,
            followerCount: true,
            physicalAddressPresent: true,
            recentActivity: true,
            category: true,
            instagramHandle: true,
          },
        })
      : null;

    const businessConversion = lead.businessId
      ? await prisma.businessConversion.findFirst({
          where: { leadId },
          select: { apolloContactJson: true, hunterContactJson: true, metadata: true, apolloHasDirectPhone: true },
          orderBy: { convertedAt: 'desc' },
        })
      : null;

    // Parse Apify structured data (Tier 1)
    const apifyWebsite = business?.apifyWebsiteScrapeJson && typeof business.apifyWebsiteScrapeJson === 'object'
      ? (business.apifyWebsiteScrapeJson as Record<string, unknown>)
      : null;
    const apifyInstagram = business?.apifyInstagramScrapeJson && typeof business.apifyInstagramScrapeJson === 'object'
      ? (business.apifyInstagramScrapeJson as Record<string, unknown>)
      : null;

    const domain = normalizeString(lead.email.split('@')[1])?.toLowerCase() ?? null;
    const normalizedPayload =
      latestEnrichment?.normalizedPayload && typeof latestEnrichment.normalizedPayload === 'object'
        ? (latestEnrichment.normalizedPayload as Record<string, unknown>)
        : null;
    const enrichmentRawPayload = latestEnrichment?.rawPayload ?? null;
    const discoveryRawPayload = latestDiscovery?.rawPayload ?? null;
    const featureSources = [normalizedPayload, enrichmentRawPayload, discoveryRawPayload];

    const companyName =
      normalizeString(normalizedPayload?.companyName) ??
      normalizeString(normalizedPayload?.company_name) ??
      normalizeString(findValueByKey(discoveryRawPayload, 'companyName'));
    const industry =
      normalizeString(normalizedPayload?.industry) ??
      normalizeString(findValueByKey(enrichmentRawPayload, 'industry')) ??
      normalizeString(findValueByKey(discoveryRawPayload, 'industry'));
    const country = normalizeCountry(
      normalizedPayload?.country ??
        normalizedPayload?.locationCountry ??
        findValueByKey(enrichmentRawPayload, 'country') ??
        findValueByKey(discoveryRawPayload, 'country') ??
        business?.countryCode,
    );
    const companySize =
      extractNumberFromSources(featureSources, [
        'employeeCount',
        'companySize',
        'employees',
        'teamSize',
      ]) ?? null;
    const reviewCount =
      extractNumberFromSources(featureSources, ['reviewCount', 'reviews', 'ratingsCount']) ||
      (business?.reviewCount ?? 0);
    const baseFollowerCount =
      extractNumberFromSources(featureSources, ['followerCount', 'followers', 'instagramFollowers']) ||
      (business?.followerCount ?? 0);
    const recentActivityDays =
      extractNumberFromSources(featureSources, ['lastActivityDays', 'daysSinceLastPost']) ?? null;

    // ── Extract Apify v2 structured features (Tier 1) ──
    const apifyPaymentWidgets = Array.isArray(apifyWebsite?.paymentWidgets)
      ? (apifyWebsite.paymentWidgets as string[])
      : [];
    const apifyPaymentWidgetCount = apifyPaymentWidgets.length;
    const apifyHasShopify = asBoolean(apifyWebsite?.hasShopify) ?? false;
    const apifyHasBookingForm = asBoolean(apifyWebsite?.hasBookingForm) ?? false;
    const apifyHasPricingTiers = asBoolean(apifyWebsite?.hasPricingTiers) ?? false;
    const apifyHasProductCatalog = asBoolean(apifyWebsite?.hasProductCatalog) ?? false;
    const apifyHasWhatsApp = apifyWebsite?.hasWhatsApp === true;
    const apifyDetectedPlatforms = Array.isArray(apifyWebsite?.detectedPlatforms)
      ? (apifyWebsite.detectedPlatforms as string[])
      : [];
    const apifyPlatform = apifyDetectedPlatforms[0] ?? 'unknown';

    const instagramFollowerCount = asNumber(apifyInstagram?.followerCount) ?? 0;
    const instagramEngagementRate = asNumber(apifyInstagram?.engagementRate) ?? 0;
    const instagramIsBusinessAccount = asBoolean(apifyInstagram?.isBusinessAccount) ?? false;
    const instagramLastPostDate = typeof apifyInstagram?.lastPostDate === 'string'
      ? new Date(apifyInstagram.lastPostDate)
      : null;
    const instagramDaysSinceLastPost = instagramLastPostDate
      ? Math.max(0, Math.floor((Date.now() - instagramLastPostDate.getTime()) / 86_400_000))
      : -1;
    const instagramHasBioLink = typeof apifyInstagram?.bioLink === 'string' && apifyInstagram.bioLink.length > 0;

    // Determine contact source and decision-maker seniority from BusinessConversion
    const apolloContact = businessConversion?.apolloContactJson && typeof businessConversion.apolloContactJson === 'object'
      ? (businessConversion.apolloContactJson as Record<string, unknown>)
      : null;
    const hunterContact = businessConversion?.hunterContactJson && typeof businessConversion.hunterContactJson === 'object'
      ? (businessConversion.hunterContactJson as Record<string, unknown>)
      : null;
    const conversionMetadata = businessConversion?.metadata && typeof businessConversion.metadata === 'object'
      ? (businessConversion.metadata as Record<string, unknown>)
      : null;
    const contactSource = apolloContact ? 'APOLLO'
      : hunterContact ? 'HUNTER'
      : (conversionMetadata?.contactSource as string) ?? 'NONE';
    const hasDecisionMakerPhone = Boolean(lead.decisionMakerPhone);
    // Read title from Apollo first, then Hunter position, then website decision makers
    const decisionMakerTitle = (
      typeof apolloContact?.title === 'string' ? apolloContact.title
      : typeof hunterContact?.position === 'string' ? hunterContact.position
      : ''
    ).toLowerCase();
    const decisionMakerSeniority =
      /owner|ceo|founder/i.test(decisionMakerTitle) ? 'executive'
      : /director|vp|head/i.test(decisionMakerTitle) ? 'director'
      : /manager/i.test(decisionMakerTitle) ? 'manager'
      : decisionMakerTitle.length > 0 ? 'other'
      : 'unknown';

    // ── v2.1 features from enhanced scrapers ──
    const websiteDecisionMakers = Array.isArray(apifyWebsite?.decisionMakers)
      ? (apifyWebsite.decisionMakers as Array<Record<string, unknown>>)
      : [];
    const decisionMakerCount = websiteDecisionMakers.length;
    const apolloHasDirectPhone = businessConversion?.apolloHasDirectPhone === true;

    const websiteContactInfo = apifyWebsite?.contactInfo && typeof apifyWebsite.contactInfo === 'object'
      ? (apifyWebsite.contactInfo as Record<string, unknown>)
      : null;
    const websiteEmailCount = Array.isArray(websiteContactInfo?.emails)
      ? (websiteContactInfo.emails as unknown[]).length
      : 0;
    const websitePhoneCount = Array.isArray(websiteContactInfo?.phones)
      ? (websiteContactInfo.phones as unknown[]).length
      : 0;

    const websiteSocialLinks = Array.isArray(apifyWebsite?.socialLinks)
      ? (apifyWebsite.socialLinks as Array<Record<string, unknown>>)
      : [];
    const socialLinkCount = websiteSocialLinks.length;
    const hasLinkedIn = websiteSocialLinks.some((s) => s.platform === 'linkedin');

    const websiteTechnologies = apifyWebsite?.technologies && typeof apifyWebsite.technologies === 'object'
      ? (apifyWebsite.technologies as Record<string, unknown>)
      : null;
    const techStackSize = websiteTechnologies
      ? Object.values(websiteTechnologies).reduce<number>(
          (sum, val) => sum + (Array.isArray(val) ? val.length : 0),
          0,
        )
      : 0;
    const hasCrm = Array.isArray(websiteTechnologies?.crm)
      ? (websiteTechnologies.crm as unknown[]).length > 0
      : false;
    const hasLiveChat = Array.isArray(websiteTechnologies?.liveChat)
      ? (websiteTechnologies.liveChat as unknown[]).length > 0
      : false;
    const hasAnalytics = Array.isArray(websiteTechnologies?.analytics)
      ? (websiteTechnologies.analytics as unknown[]).length > 0
      : false;

    const websiteBusinessSignals = apifyWebsite?.businessSignals && typeof apifyWebsite.businessSignals === 'object'
      ? (apifyWebsite.businessSignals as Record<string, unknown>)
      : null;
    const estimatedEmployees = asNumber(websiteBusinessSignals?.estimatedEmployeeCount) ?? 0;
    const certificationCount = Array.isArray(websiteBusinessSignals?.certifications)
      ? (websiteBusinessSignals.certifications as unknown[]).length
      : 0;

    const instagramBusinessCategory = typeof apifyInstagram?.businessCategory === 'string'
      ? apifyInstagram.businessCategory
      : 'unknown';
    const instagramHasBusinessEmail = typeof apifyInstagram?.businessEmail === 'string'
      && (apifyInstagram.businessEmail as string).length > 0;

    // ── Cross-source data alignment score ──
    const websiteTitle = typeof apifyWebsite?.pageTitle === 'string' ? apifyWebsite.pageTitle : null;
    const websiteDetectedCountry = typeof apifyWebsite?.detectedCountry === 'string'
      ? apifyWebsite.detectedCountry
      : null;
    const alignmentResult = computeDataAlignmentScore({
      serpApiName: business?.name ?? companyName ?? null,
      websiteTitle,
      websiteDomain: business?.websiteDomain ? extractDomain(business.websiteDomain) : (domain ? domain : null),
      instagramUsername: business?.instagramHandle ?? null,
      serpApiCountry: country,
      websiteCountry: normalizeCountry(websiteDetectedCountry) ?? null,
      leadEmailDomain: domain,
    });
    const dataAlignmentScore = alignmentResult.score;

    // Reconcile follower count: prefer Instagram structured data over enrichment/keyword fallback
    const followerCount = instagramFollowerCount > 0 ? instagramFollowerCount : baseFollowerCount;

    // ── Feature extraction: Tier 1 (Apify) → Tier 2 (enrichment) → Tier 3 (keyword) ──
    const hasWhatsapp =
      apifyHasWhatsApp ||
      (business?.hasWhatsapp ?? false) ||
      (apifyPaymentWidgets.some((w) => w.toLowerCase().includes('whatsapp'))) ||
      (extractBooleanFromSources(featureSources, ['hasWhatsapp', 'whatsapp']) ??
      includesAnyKeyword(featureSources, ['whatsapp', 'wa.me']));
    const hasInstagram =
      apifyInstagram !== null ||
      (business?.hasInstagram ?? false) ||
      Boolean(business?.instagramHandle) ||
      (extractBooleanFromSources(featureSources, ['hasInstagram', 'instagramActive']) ??
      includesAnyKeyword(featureSources, ['instagram.com', 'instagram']));
    const acceptsOnlinePayments =
      apifyPaymentWidgetCount > 0 ||
      (extractBooleanFromSources(featureSources, ['acceptsOnlinePayments', 'onlinePayments']) ??
      includesAnyKeyword(featureSources, [
        'online payment', 'checkout', 'stripe', 'paytabs', 'apple pay', 'mada',
      ]));
    const physicalAddressPresent =
      (business?.physicalAddressPresent ?? false) ||
      (extractBooleanFromSources(featureSources, ['physicalAddressPresent', 'hasAddress']) ??
      Boolean(normalizeString(findValueByKey(featureSources, 'address'))));
    const recentActivity =
      (instagramDaysSinceLastPost >= 0 && instagramDaysSinceLastPost <= 45) ||
      (business?.recentActivity ?? false) ||
      (extractBooleanFromSources(featureSources, ['recentActivity', 'isRecentlyActive']) ??
      (recentActivityDays !== null ? recentActivityDays <= 45 : false));
    const customOrderSignals =
      apifyHasBookingForm ||
      (extractBooleanFromSources(featureSources, ['customOrderSignals']) ??
      includesAnyKeyword(featureSources, [
        'custom order', 'made to order', 'dm to order',
        'by appointment', 'request a quote', 'consultation',
        'proposal', 'bespoke', 'made-to-measure', 'inquire',
        'book a session', 'get a quote', 'request quote',
        'whatsapp order', 'dm for price', 'quotation', 'retainer',
      ]));
    const shopifyDetected =
      apifyHasShopify ||
      (extractBooleanFromSources(featureSources, ['shopifyDetected']) ??
      includesAnyKeyword(featureSources, ['shopify', 'myshopify']));
    const multiStaffDetected =
      extractBooleanFromSources(featureSources, ['multiStaffDetected']) ??
      (companySize !== null ? companySize >= 4 : false);
    const followerGrowthSignal =
      (instagramFollowerCount > 0 && asNumber(apifyInstagram?.recentPostCount) !== null
        ? instagramFollowerCount / Math.max(1, asNumber(apifyInstagram?.recentPostCount) ?? 1) > 100
        : false) ||
      (extractBooleanFromSources(featureSources, ['followerGrowthSignal']) ??
      ((extractNumberFromSources(featureSources, ['followerGrowthRate']) ?? 0) > 0));
    const highEngagementSignal =
      instagramEngagementRate >= 0.03 ||
      (extractBooleanFromSources(featureSources, ['highEngagementSignal']) ??
      ((extractNumberFromSources(featureSources, ['engagementRate']) ?? 0) >= 0.03));
    const hasBookingOrContactForm =
      apifyHasBookingForm ||
      (extractBooleanFromSources(featureSources, ['hasBookingOrContactForm']) ??
      includesAnyKeyword(featureSources, ['book now', 'book a call', 'contact us', 'appointment']));
    const variablePricingDetected =
      apifyHasPricingTiers ||
      (extractBooleanFromSources(featureSources, ['variablePricingDetected']) ??
      includesAnyKeyword(featureSources, ['starting at', 'from ', 'price on request']));
    const pureSelfServeEcom =
      extractBooleanFromSources(featureSources, ['pureSelfServeEcom']) ??
      (shopifyDetected && !hasWhatsapp && !customOrderSignals);

    const highTicketSignals =
      extractBooleanFromSources(featureSources, ['highTicketSignals']) ??
      includesAnyKeyword(featureSources, [
        'luxury', 'premium', 'bespoke', 'VIP', 'concierge',
        'high-end', 'exclusive', 'by appointment only',
        'AED 5,000', 'AED 10,000', 'AED 50,000', 'AED 100,000',
        'starting at AED', 'from AED',
        'charter', 'wedding package', 'treatment package',
      ]);

    const depositMilestoneSignals =
      extractBooleanFromSources(featureSources, ['depositMilestoneSignals']) ??
      includesAnyKeyword(featureSources, [
        'deposit required', '50% upfront', 'milestone payment',
        'staged payment', 'balance payment', 'partial payment',
        'installment', 'advance payment', 'balance due',
        'deposit', 'down payment',
        'booking fee', 'reservation fee', 'retainer', 'progress payment',
      ]);

    const subscriptionBillingDetected =
      extractBooleanFromSources(featureSources, ['subscriptionBillingDetected']) ??
      includesAnyKeyword(featureSources, [
        'subscription', 'monthly plan', 'recurring billing',
        'auto-renew', 'annual plan', 'per month', 'SaaS',
        'recurring payment', 'monthly fee',
      ]);

    const internationalCustomerSignals =
      extractBooleanFromSources(featureSources, ['internationalCustomerSignals']) ??
      includesAnyKeyword(featureSources, [
        'international clients', 'remote payment', 'worldwide',
        'multi-currency', 'global clients', 'international customers',
        'overseas', 'cross-border',
        'GCC', 'expat', 'tourist',
      ]);

    const seasonalSignals =
      extractBooleanFromSources(featureSources, ['seasonalSignals']) ??
      includesAnyKeyword(featureSources, [
        'seasonal collection', 'ramadan collection', 'eid collection',
        'valentine special', 'holiday season', 'peak season',
        'festive season', 'seasonal menu', 'seasonal offer',
        'limited edition', 'trunk show', 'pop-up market',
        'seasonal sale', "mother's day special",
      ]);

    const bankTransferReliance =
      extractBooleanFromSources(featureSources, ['bankTransferReliance']) ??
      includesAnyKeyword(featureSources, [
        'bank transfer', 'wire transfer', 'IBAN',
        'bank deposit', 'account transfer', 'swift transfer',
        'bank details',
      ]);

    const upsellSignals =
      extractBooleanFromSources(featureSources, ['upsellSignals']) ??
      includesAnyKeyword(featureSources, [
        'add-on', 'upgrade', 'upsell', 'extras',
        'additional services', 'premium upgrade',
        'add-on service', 'package upgrade',
      ]);

    const priceLedMindset =
      extractBooleanFromSources(featureSources, ['priceLedMindset']) ??
      includesAnyKeyword(featureSources, [
        'lowest price', 'cheapest', 'budget-friendly',
        'best price guarantee', 'price match', 'compare prices',
        'bargain', 'wholesale pricing', 'economy',
      ]);

    const targetIndustries = new Set(icp.targetIndustries.map((entry) => entry.toLowerCase()));
    const targetCountries = new Set(
      icp.targetCountries
        .map((entry) => normalizeCountry(entry))
        .filter((entry): entry is string => entry !== null)
        .map((entry) => entry.toLowerCase()),
    );
    const normalizedIndustry = industry?.toLowerCase() ?? null;
    const normalizedCountry = country?.toLowerCase() ?? null;

    const industryMatch =
      targetIndustries.size === 0 ||
      (normalizedIndustry !== null && targetIndustries.has(normalizedIndustry));
    const geoMatch =
      targetCountries.size === 0 ||
      (normalizedCountry !== null && targetCountries.has(normalizedCountry));
    const industrySupported = industryMatch;

    const icpSegmentPriority = classifyIcpSegmentPriority(industry, targetIndustries);
    const reviewCountTier = toReviewCountTier(reviewCount);
    const followerCountTier = toFollowerCountTier(followerCount);

    const featurePayload = buildFeaturePayload({
      sourceProvider: latestDiscovery?.provider ?? 'UNKNOWN',
      hasEmail: Boolean(normalizeString(lead.email)),
      hasDomain: Boolean(domain),
      hasCompanyName: Boolean(companyName),
      country,
      industry,
      industrySupported,
      hasWhatsapp,
      hasInstagram,
      acceptsOnlinePayments,
      reviewCount,
      followerCount,
      physicalAddressPresent,
      recentActivity,
      customOrderSignals,
      pureSelfServeEcom,
      shopifyDetected,
      multiStaffDetected,
      followerGrowthSignal,
      highEngagementSignal,
      hasBookingOrContactForm,
      variablePricingDetected,
      industryMatch,
      industryMatchReason:
        targetIndustries.size === 0
          ? 'NO_ICP_INDUSTRY_CONSTRAINT'
          : industryMatch
            ? 'MATCHED'
            : 'NOT_MATCHED',
      geoMatch,
      geoMatchReason:
        targetCountries.size === 0
          ? 'NO_ICP_GEO_CONSTRAINT'
          : geoMatch
            ? 'MATCHED'
            : 'NOT_MATCHED',
      employeeSizeBucket: toEmployeeSizeBucket(companySize),
      highTicketSignals,
      depositMilestoneSignals,
      subscriptionBillingDetected,
      internationalCustomerSignals,
      icpSegmentPriority,
      reviewCountTier,
      followerCountTier,
      seasonalSignals,
      bankTransferReliance,
      upsellSignals,
      priceLedMindset,
      // v2 features
      apifyPaymentWidgetCount,
      apifyHasShopify,
      apifyHasBookingForm,
      apifyHasPricingTiers,
      apifyHasProductCatalog,
      apifyPlatform,
      instagramFollowerCount,
      instagramEngagementRate,
      instagramIsBusinessAccount,
      instagramDaysSinceLastPost,
      instagramHasBioLink,
      hasDecisionMakerPhone,
      decisionMakerSeniority,
      contactSource,
      // v2.1 features (enhanced scrapers)
      decisionMakerCount,
      apolloHasDirectPhone,
      websiteEmailCount,
      websitePhoneCount,
      socialLinkCount,
      hasLinkedIn,
      techStackSize,
      hasCrm,
      hasLiveChat,
      hasAnalytics,
      estimatedEmployees,
      certificationCount,
      instagramBusinessCategory,
      instagramHasBusinessEmail,
      // v3 features (data alignment)
      dataAlignmentScore,
    });

    const deterministicPreview = evaluateDeterministicScore(asDeterministicRules(rules), {
      ...featurePayload,
      icp_profile_id: icpProfileId,
      lead_source: lead.source,
    });

    // Data alignment hard filter: override hardFilterPassed if alignment < 0.3
    const alignmentHardFilter = dataAlignmentScore < 0.3;
    if (alignmentHardFilter) {
      deterministicPreview.hardFilterPassed = false;
      deterministicPreview.reasonCodes.push('DATA_ALIGNMENT_HARD_FILTER');
      deterministicPreview.qualificationPath = 'HARD_FILTERED';
      deterministicPreview.qualificationScore = 0;
      logger.warn(
        {
          jobId: job.id,
          runId,
          leadId,
          dataAlignmentScore,
          alignmentChecks: alignmentResult.checks,
        },
        'Data alignment score below 0.3 — hard filter applied (cross-source data mismatch)',
      );
    } else if (dataAlignmentScore < 0.5) {
      logger.info(
        {
          jobId: job.id,
          runId,
          leadId,
          dataAlignmentScore,
          alignmentChecks: alignmentResult.checks,
        },
        'Data alignment score in caution range (0.3-0.5), stored as weighted feature',
      );
    }

    const sourceVersion = FEATURE_EXTRACTOR_VERSION;
    const featureVectorHash = computeFeatureVectorHash(featurePayload);

    const snapshot = await prisma.leadFeatureSnapshot.upsert({
      where: {
        leadId_icpProfileId_snapshotVersion_sourceVersion_featureVectorHash: {
          leadId,
          icpProfileId,
          snapshotVersion,
          sourceVersion,
          featureVectorHash,
        },
      },
      create: {
        leadId,
        icpProfileId,
        discoveryRecordId: latestDiscovery?.id ?? null,
        enrichmentRecordId: latestEnrichment?.id ?? null,
        snapshotVersion,
        sourceVersion,
        featureVectorHash,
        featuresJson: toInputJson(featurePayload),
        ruleMatchCount: deterministicPreview.ruleMatchCount,
        hardFilterPassed: deterministicPreview.hardFilterPassed,
        computedAt: new Date(),
      },
      update: {
        discoveryRecordId: latestDiscovery?.id ?? null,
        enrichmentRecordId: latestEnrichment?.id ?? null,
        featuresJson: toInputJson(featurePayload),
        ruleMatchCount: deterministicPreview.ruleMatchCount,
        hardFilterPassed: deterministicPreview.hardFilterPassed,
        computedAt: new Date(),
      },
    });

    if (dependencies.enqueueScoring !== false) {
      const scoringPayload: ScoringComputeJobPayload = {
        runId,
        mode: 'BY_LEAD_IDS',
        icpProfileId,
        leadIds: [leadId],
        correlationId: effectiveCorrelationId,
      };

      await prisma.jobExecution.create({
        data: {
          type: SCORING_COMPUTE_JOB_NAME,
          status: 'queued',
          payload: toInputJson({
            ...scoringPayload,
            featureSnapshotId: snapshot.id,
          }),
          leadId,
        },
      });

      await dependencies.boss.send(SCORING_COMPUTE_JOB_NAME, scoringPayload, {
        singletonKey: `scoring.compute:${runId}:${leadId}:${icpProfileId}`,
        ...SCORING_COMPUTE_RETRY_OPTIONS,
      });
    }

    // --- Feature drift detection (lightweight, in-memory per batch) ---
    try {
      const currentBatchSnapshots = await prisma.leadFeatureSnapshot.findMany({
        where: { icpProfileId, snapshotVersion },
        select: { featuresJson: true },
      });

      if (currentBatchSnapshots.length >= DRIFT_DETECTION_MIN_BATCH_SIZE) {
        const previousSnapshots = await prisma.leadFeatureSnapshot.findMany({
          where: {
            icpProfileId,
            snapshotVersion: { lt: snapshotVersion },
          },
          select: { featuresJson: true },
          orderBy: { computedAt: 'desc' },
          take: 200,
        });

        if (previousSnapshots.length >= DRIFT_DETECTION_MIN_BATCH_SIZE) {
          const featureKeys = FEATURE_KEYS as unknown as string[];
          const previousRates = computePopulationRates(
            previousSnapshots.map((s) => s.featuresJson as Record<string, unknown>),
            featureKeys,
          );
          const currentRates = computePopulationRates(
            currentBatchSnapshots.map((s) => s.featuresJson as Record<string, unknown>),
            featureKeys,
          );

          const drifted = detectFeatureDrift(previousRates, currentRates, DRIFT_DETECTION_THRESHOLD);

          if (drifted.length > 0) {
            logger.warn(
              {
                jobId: job.id,
                runId,
                correlationId: effectiveCorrelationId,
                icpProfileId,
                snapshotVersion,
                batchSize: currentBatchSnapshots.length,
                previousBatchSize: previousSnapshots.length,
                driftedFeatures: drifted.map((d) => ({
                  feature: d.feature,
                  previousRate: Number(d.previousRate.toFixed(3)),
                  currentRate: d.currentRate,
                })),
              },
              `Feature drift detected: ${drifted.length} feature(s) dropped to 0% (previously >30%)`,
            );
          }
        }
      }
    } catch (driftError: unknown) {
      // Drift detection is non-critical — never fail the job for it
      logger.warn(
        {
          jobId: job.id,
          runId,
          correlationId: effectiveCorrelationId,
          leadId,
          error: driftError,
        },
        'Feature drift detection failed (non-critical)',
      );
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        leadId,
        featureSnapshotId: snapshot.id,
        featureVectorHash,
      },
      'Completed features.compute job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        leadId,
        error,
      },
      'Failed features.compute job',
    );

    throw classifyError(error);
  }
}
