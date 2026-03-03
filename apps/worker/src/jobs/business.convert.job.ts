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

/** Generic email patterns — skip these in favor of personal emails. */
const GENERIC_EMAIL_PREFIXES = new Set([
  'info', 'contact', 'hello', 'support', 'admin', 'sales', 'office',
  'help', 'service', 'enquiry', 'inquiry', 'general', 'team', 'mail',
  'noreply', 'no-reply', 'webmaster', 'postmaster', 'marketing',
  'hr', 'finance', 'billing', 'accounts', 'reception', 'feedback',
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

interface SmtpVerificationResult {
  email: string;
  status: 'valid' | 'catch_all' | 'invalid' | 'disposable' | 'no_mx' | 'smtp_error' | 'timeout';
  isCatchAll: boolean;
  isDisposable: boolean;
  durationMs: number;
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
  smtpVerifier?: {
    verify(email: string): Promise<SmtpVerificationResult>;
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

// ── Resolved contact ────────────────────────────────────────────────────
interface ResolvedContact {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  linkedinUrl: string | null;
  source: 'WEBSITE_SCRAPE' | 'INSTAGRAM' | 'APOLLO' | 'HUNTER';
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

function isGenericEmail(email: string): boolean {
  const prefix = email.split('@')[0]?.toLowerCase();
  if (!prefix) return true;
  return GENERIC_EMAIL_PREFIXES.has(prefix);
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

  // ── 5. Extract best contact from scrape data ──────────────────────────
  let resolvedContact: ResolvedContact | null = null;
  let apolloContactJson: unknown = null;
  let hunterContactJson: unknown = null;
  const costEvents: Array<{ provider: 'APOLLO' | 'HUNTER' | 'SERPAPI'; costCents: number; apiCallType: string }> = [];

  // 5a. Try decision makers from website scrape (sorted by seniority)
  if (websiteScrapeData?.decisionMakers && websiteScrapeData.decisionMakers.length > 0) {
    const sortedDMs = [...websiteScrapeData.decisionMakers]
      .filter((dm) => dm.email && !isGenericEmail(dm.email))
      .sort((a, b) => seniorityRank(a.seniority) - seniorityRank(b.seniority));

    for (const dm of sortedDMs) {
      if (!dm.email) continue;

      // SMTP verify if verifier is available
      if (deps.smtpVerifier?.isConfigured) {
        const verification = await deps.smtpVerifier.verify(dm.email);
        if (verification.status === 'valid' || verification.status === 'catch_all') {
          const { firstName, lastName } = parseName(dm.name);
          resolvedContact = {
            firstName,
            lastName,
            email: dm.email,
            phone: null,
            title: dm.title,
            linkedinUrl: dm.linkedinUrl,
            source: 'WEBSITE_SCRAPE',
            rawJson: dm,
          };
          logger.info(
            { ...logCtx, email: dm.email, smtpStatus: verification.status, seniority: dm.seniority },
            'SMTP-verified decision maker contact from website scrape',
          );
          break;
        }
        logger.info(
          { ...logCtx, email: dm.email, smtpStatus: verification.status },
          'Decision maker email failed SMTP verification — trying next',
        );
      } else {
        // No SMTP verifier — use the email directly (best effort)
        const { firstName, lastName } = parseName(dm.name);
        resolvedContact = {
          firstName,
          lastName,
          email: dm.email,
          phone: null,
          title: dm.title,
          linkedinUrl: dm.linkedinUrl,
          source: 'WEBSITE_SCRAPE',
          rawJson: dm,
        };
        break;
      }
    }
  }

  // 5b. Try personal emails from contactInfo (non-generic, non-decision-maker)
  if (!resolvedContact && websiteScrapeData?.contactInfo?.emails) {
    const personalEmails = websiteScrapeData.contactInfo.emails
      .filter((e) => !isGenericEmail(e.email));

    for (const emailEntry of personalEmails) {
      if (deps.smtpVerifier?.isConfigured) {
        const verification = await deps.smtpVerifier.verify(emailEntry.email);
        if (verification.status === 'valid' || verification.status === 'catch_all') {
          resolvedContact = {
            firstName: business.name,
            lastName: '',
            email: emailEntry.email,
            phone: null,
            title: null,
            linkedinUrl: null,
            source: 'WEBSITE_SCRAPE',
            rawJson: emailEntry,
          };
          logger.info(
            { ...logCtx, email: emailEntry.email, smtpStatus: verification.status },
            'SMTP-verified personal email from website contactInfo',
          );
          break;
        }
      } else {
        resolvedContact = {
          firstName: business.name,
          lastName: '',
          email: emailEntry.email,
          phone: null,
          title: null,
          linkedinUrl: null,
          source: 'WEBSITE_SCRAPE',
          rawJson: emailEntry,
        };
        break;
      }
    }
  }

  // 5c. Try Instagram business email
  if (!resolvedContact && instagramData?.businessEmail && !isGenericEmail(instagramData.businessEmail)) {
    if (deps.smtpVerifier?.isConfigured) {
      const verification = await deps.smtpVerifier.verify(instagramData.businessEmail);
      if (verification.status === 'valid' || verification.status === 'catch_all') {
        resolvedContact = {
          firstName: business.name,
          lastName: '',
          email: instagramData.businessEmail,
          phone: instagramData.businessPhone ?? null,
          title: null,
          linkedinUrl: null,
          source: 'INSTAGRAM',
          rawJson: instagramData,
        };
        logger.info(
          { ...logCtx, email: instagramData.businessEmail, smtpStatus: verification.status },
          'SMTP-verified Instagram business email',
        );
      }
    } else {
      resolvedContact = {
        firstName: business.name,
        lastName: '',
        email: instagramData.businessEmail,
        phone: instagramData.businessPhone ?? null,
        title: null,
        linkedinUrl: null,
        source: 'INSTAGRAM',
        rawJson: instagramData,
      };
    }
  }

  // Enrich phone from website scrape if contact has no phone
  if (resolvedContact && !resolvedContact.phone && websiteScrapeData?.contactInfo?.phones) {
    const bestPhone = websiteScrapeData.contactInfo.phones[0];
    if (bestPhone) {
      resolvedContact.phone = bestPhone.number;
    }
  }

  // ── 6. Fallback to paid providers (Hunter → Apollo) ────────────────────
  let hunterRetryable = false;
  let apolloRetryable = false;

  if (!resolvedContact) {
    logger.info(
      logCtx,
      'No valid contact from scrape data — falling back to paid providers',
    );

    // 6a. Hunter (cheaper, better for domain-search)
    if (deps.hunterAdapter.isConfigured) {
      const hunterResult = await deps.hunterAdapter.searchDomainContacts(domain);

      if (hunterResult.status === 'success' && hunterResult.contacts.length > 0) {
        const contact = hunterResult.contacts[0]!;
        hunterContactJson = hunterResult.contacts;
        resolvedContact = {
          firstName: contact.firstName ?? '',
          lastName: contact.lastName ?? '',
          email: contact.email,
          phone: null,
          title: contact.position,
          linkedinUrl: null,
          source: 'HUNTER',
          rawJson: contact,
        };
      } else if (hunterResult.status === 'retryable_error') {
        hunterRetryable = true;
      }

      costEvents.push({ provider: 'HUNTER', costCents: 1, apiCallType: 'domain_search' });

      logger.info(
        { ...logCtx, hunterStatus: hunterResult.status, contactsFound: hunterResult.status === 'success' ? hunterResult.contacts.length : 0 },
        'Hunter domain search completed (fallback)',
      );
    }

    // 6b. Apollo (more expensive, may have phone numbers)
    if (!resolvedContact && deps.apolloAdapter.isConfigured) {
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
          linkedinUrl: null,
          source: 'APOLLO',
          rawJson: contact,
        };
      } else if (apolloResult.status === 'retryable_error') {
        apolloRetryable = true;
      }

      costEvents.push({ provider: 'APOLLO', costCents: 1, apiCallType: 'contact_search' });

      logger.info(
        { ...logCtx, apolloStatus: apolloResult.status, contactsFound: apolloResult.status === 'success' ? apolloResult.contacts.length : 0 },
        'Apollo contact search completed (fallback)',
      );
    }
  } else {
    logger.info(
      { ...logCtx, contactSource: resolvedContact.source, email: resolvedContact.email },
      'Contact resolved from scrape data — skipping paid providers',
    );
  }

  // 6c. Both paid providers retryable → throw to trigger pg-boss retry
  if (!resolvedContact && hunterRetryable && apolloRetryable) {
    throw new Error(
      `Both Hunter and Apollo returned retryable errors for domain ${domain}`,
    );
  }

  // 6d. No contact from any source → terminal, can't create lead
  if (!resolvedContact) {
    logger.warn(
      { ...logCtx, reason: 'NO_CONTACTS_FOUND' },
      'No decision-maker contacts found from any source — cannot create lead',
    );
    return;
  }

  // ── 7. Create Lead + BusinessConversion + CostEvents in ONE transaction ─
  const contactEmail = resolvedContact.email;
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
          apolloContactJson: apolloContactJson
            ? toInputJson(apolloContactJson)
            : Prisma.JsonNull,
          hunterContactJson: hunterContactJson
            ? toInputJson(hunterContactJson)
            : Prisma.JsonNull,
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

  // ── 8. Enqueue enrichment.run if lead is newly created ────────────────
  if (txResult.isNew && deps.enqueueEnrichmentRun) {
    await deps.enqueueEnrichmentRun({
      runId: discoveryRunId,
      leadId: txResult.lead.id,
      icpProfileId,
      correlationId: effectiveCorrelationId,
    });

    logger.info(
      { ...logCtx, leadId: txResult.lead.id },
      'Enqueued enrichment.run for newly created lead',
    );
  }

  // ── 9. Completion log ─────────────────────────────────────────────────
  logger.info(
    {
      ...logCtx,
      leadId: txResult.lead.id,
      isNewLead: txResult.isNew,
      contactSource: resolvedContact.source,
      paidProvidersCalled: costEvents.length,
      hunterSkipped: costEvents.every((ce) => ce.provider !== 'HUNTER'),
      apolloSkipped: costEvents.every((ce) => ce.provider !== 'APOLLO'),
    },
    'Completed business.convert job',
  );
}
