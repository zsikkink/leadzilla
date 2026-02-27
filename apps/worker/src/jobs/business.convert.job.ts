import { Prisma, prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

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
      linkedinUrl: string | null;
      seniority: 'executive' | 'director' | 'manager' | 'other';
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
  } | undefined;
}

export interface BusinessConvertJobDependencies {
  apolloAdapter: {
    searchContactsByDomain(domain: string): Promise<ApolloContactSearchResult>;
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
  enqueueEnrichmentRun?: ((payload: {
    runId: string;
    leadId: string;
    icpProfileId: string;
    correlationId?: string | undefined;
  }) => Promise<void>) | undefined;
}

export interface BusinessConvertLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

// ── Resolved contact from either provider ──────────────────────────────
interface ResolvedContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  source: 'APOLLO' | 'HUNTER';
  rawJson: unknown;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function isCacheValid(scrapedAt: Date | null): boolean {
  if (!scrapedAt) return false;
  return Date.now() - scrapedAt.getTime() < SCRAPE_CACHE_TTL_MS;
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

  // ── 3. Find decision-maker contact (Apollo → Hunter fallback) ─────────
  let resolvedContact: ResolvedContact | null = null;
  let apolloContactJson: unknown = null;
  let hunterContactJson: unknown = null;
  let apolloRetryable = false;
  let hunterRetryable = false;

  // 3a. Try Apollo
  if (deps.apolloAdapter.isConfigured) {
    const apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);

    if (apolloResult.status === 'success' && apolloResult.contacts.length > 0) {
      const contact = apolloResult.contacts[0]!;
      apolloContactJson = contact;
      resolvedContact = {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        title: contact.title,
        source: 'APOLLO',
        rawJson: contact,
      };
    } else if (apolloResult.status === 'retryable_error') {
      apolloRetryable = true;
    }

    // Record cost event for Apollo call (regardless of outcome)
    await prisma.discoveryCostEvent.create({
      data: {
        discoveryRunId,
        provider: 'APOLLO',
        costCents: 1,
        apiCallType: 'contact_search',
        businessId,
      },
    });

    logger.info(
      { ...logCtx, apolloStatus: apolloResult.status, contactsFound: apolloResult.status === 'success' ? apolloResult.contacts.length : 0 },
      'Apollo contact search completed',
    );
  }

  // 3b. Fallback to Hunter if Apollo didn't yield a contact
  if (!resolvedContact && deps.hunterAdapter.isConfigured) {
    const hunterResult = await deps.hunterAdapter.searchDomainContacts(domain);

    if (hunterResult.status === 'success' && hunterResult.contacts.length > 0) {
      const contact = hunterResult.contacts[0]!;
      hunterContactJson = contact;
      resolvedContact = {
        firstName: contact.firstName ?? '',
        lastName: contact.lastName ?? '',
        email: contact.email,
        phone: null, // Hunter doesn't return phone
        title: contact.position,
        source: 'HUNTER',
        rawJson: contact,
      };
    } else if (hunterResult.status === 'retryable_error') {
      hunterRetryable = true;
    }

    // Record cost event for Hunter call
    await prisma.discoveryCostEvent.create({
      data: {
        discoveryRunId,
        provider: 'HUNTER',
        costCents: 1,
        apiCallType: 'domain_search',
        businessId,
      },
    });

    logger.info(
      { ...logCtx, hunterStatus: hunterResult.status, contactsFound: hunterResult.status === 'success' ? hunterResult.contacts.length : 0 },
      'Hunter domain search completed',
    );
  }

  // 3c. Both providers retryable → throw to trigger pg-boss retry
  if (!resolvedContact && apolloRetryable && hunterRetryable) {
    throw new Error(
      `Both Apollo and Hunter returned retryable errors for domain ${domain}`,
    );
  }

  // 3d. No contact from either provider → terminal, can't create lead
  if (!resolvedContact) {
    logger.warn(
      { ...logCtx, reason: 'NO_CONTACTS_FOUND' },
      'No decision-maker contacts found from any provider — cannot create lead',
    );
    return;
  }

  // ── 4. Website scrape (optional, zero cost — our own scraper) ─────────
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
      // Even from cache, try to extract Instagram handle for step 5
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
        const updateData: Record<string, unknown> = {
          apifyWebsiteScrapeJson: toInputJson(websiteResult.data),
          websiteScrapedAt: new Date(),
        };

        // Discover Instagram handle from website social links if not already known
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

  // ── 5. Instagram scrape (optional, zero cost — our own scraper) ──────
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
    } else {
      const igResult = await deps.instagramScraperAdapter.scrapeProfile(
        instagramHandle,
      );

      if (igResult.status === 'success' && igResult.data) {
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

  // ── 6. Create Lead + BusinessConversion in a transaction ──────────────
  const contactEmail = resolvedContact.email;
  const isNewLead = await prisma.$transaction(async (tx) => {
    // Check for existing lead with same email (dedup)
    const existingLead = await tx.lead.findFirst({
      where: { email: contactEmail },
      select: { id: true },
    });

    if (existingLead) {
      // Lead already exists — still create BusinessConversion to track the link
      logger.info(
        { ...logCtx, existingLeadId: existingLead.id, email: contactEmail },
        'Lead with this email already exists — linking via BusinessConversion',
      );

      await tx.businessConversion.create({
        data: {
          businessId: business.id,
          leadId: existingLead.id,
          apolloContactJson: apolloContactJson
            ? toInputJson(apolloContactJson)
            : Prisma.JsonNull,
          hunterContactJson: hunterContactJson
            ? toInputJson(hunterContactJson)
            : Prisma.JsonNull,
        },
      }).catch((err: unknown) => {
        // Handle unique constraint violation (businessId, leadId) gracefully
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

      return { lead: existingLead, isNew: false };
    }

    // Determine first/last name — use contact data, fallback to business name
    const firstName = resolvedContact.firstName || business.name;
    const lastName = resolvedContact.lastName || '';

    const lead = await tx.lead.create({
      data: {
        firstName,
        lastName,
        email: contactEmail,
        phone: resolvedContact.phone ?? business.phoneE164 ?? null,
        businessId: business.id,
        decisionMakerTitle: resolvedContact.title ?? null,
        decisionMakerPhone: resolvedContact.phone ?? null,
        source: 'SERPAPI_DISCOVERY',
        status: 'new',
      },
    });

    await tx.businessConversion.create({
      data: {
        businessId: business.id,
        leadId: lead.id,
        apolloContactJson: apolloContactJson
          ? toInputJson(apolloContactJson)
          : Prisma.JsonNull,
        hunterContactJson: hunterContactJson
          ? toInputJson(hunterContactJson)
          : Prisma.JsonNull,
      },
    });

    return { lead, isNew: true };
  });

  // ── 7. Enqueue enrichment.run if lead is newly created ────────────────
  if (isNewLead.isNew && deps.enqueueEnrichmentRun) {
    await deps.enqueueEnrichmentRun({
      runId: discoveryRunId,
      leadId: isNewLead.lead.id,
      icpProfileId,
      correlationId: effectiveCorrelationId,
    });

    logger.info(
      { ...logCtx, leadId: isNewLead.lead.id },
      'Enqueued enrichment.run for newly created lead',
    );
  }

  // ── 8. Completion log ─────────────────────────────────────────────────
  logger.info(
    {
      ...logCtx,
      leadId: isNewLead.lead.id,
      isNewLead: isNewLead.isNew,
      contactSource: resolvedContact.source,
    },
    'Completed business.convert job',
  );
}
