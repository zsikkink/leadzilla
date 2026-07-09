import { MESSAGE_DRAFT_EVENTS_CHANNEL, type GenerateMessageDraftRequest } from '@lead-flood/contracts';
import { prisma, toInputJson } from '@lead-flood/db';
import type { OpenAiAdapter } from '@lead-flood/providers';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { RetryableError, classifyError } from '../errors.js';
import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';
import { recordPipelineEvent } from '../utils/pipeline-events.js';
import {
  getMessagingBehaviorPrompt,
  getMessagingModel,
  getMessagingRole,
  getMessagingSystemPrompt,
  isManualApprovalOnlyEnabled,
  loadAutoApproveConfig,
  loadVerifiedScoreQualificationThreshold,
  shouldAutoApprove,
} from '../utils/pipeline-settings.js';

import {
  validateMessageVariant,
  mergeCtaIntoBody,
  ensureZbooniTeamSignoff,
  buildStricterPromptSuffix,
  checkNegativeKeywords,
  buildNegativeKeywordPromptSuffix,
  type MessageQualityOptions,
} from '../messaging/validate-message.js';

export const MESSAGE_GENERATE_JOB_NAME = 'message.generate';
export const MESSAGE_GENERATE_IDEMPOTENCY_KEY_PATTERN =
  'message.generate:${leadId}:${icpProfileId}';

export const MESSAGE_GENERATE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 45,
  retryBackoff: true,
  deadLetter: 'message.generate.dead_letter',
};

const MESSAGE_VALIDATION_MAX_ATTEMPTS = 5;

// Worker execution reloads the current score before eligibility checks,
// approval, and persistence, so queued jobs do not carry scorePredictionId.
export interface MessageGenerateJobPayload
  extends Pick<
    GenerateMessageDraftRequest,
    'leadId' | 'icpProfileId' | 'knowledgeEntryIds' | 'promptVersion' | 'forceRegenerate' | 'redraftFeedback'
  >,
    Partial<Pick<GenerateMessageDraftRequest, 'channel'>> {
  runId: string;
  correlationId?: string | undefined;
  followUpNumber?: number | undefined;
  parentMessageSendId?: string | undefined;
  previouslyPitchedFeatures?: string[] | undefined;
}

export interface MessageGenerateLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface MessageGenerateJobDependencies {
  openAiAdapter: OpenAiAdapter;
  boss?: Pick<PgBoss, 'send'> | undefined;
}

type OpenAiMessageGenerationContext = Parameters<OpenAiAdapter['generateMessageVariants']>[0];

interface MessageContext {
  companyInsight: string | null;
  socialPresence: string | null;
  techGap: string | null;
  teamSignal: string | null;
}

type RecipientType = 'DECISION_MAKER' | 'GENERIC_CONTACT';
type RecipientEmailKind = 'PERSONAL' | 'GENERIC' | 'UNKNOWN';

interface RecipientContext {
  recipientType: RecipientType;
  recipientName: string | null;
  recipientTitle: string | null;
  recipientEmailKind: RecipientEmailKind;
}

const GENERIC_EMAIL_PREFIXES = new Set([
  'admin',
  'booking',
  'bookings',
  'contact',
  'customerservice',
  'hello',
  'help',
  'info',
  'office',
  'orders',
  'reception',
  'reservations',
  'sales',
  'service',
  'support',
  'team',
]);

const BUSINESS_SIGNAL_PATTERNS = [
  /\b(?:Shopify|WordPress|Square|Crisp|Hotjar|Google Analytics|Meta Pixel|WhatsApp|Instagram|CRM|live chat|tiered pricing|pricing tiers|payment widget|booking form|product catalog|Tabby|Tamara)\b/gi,
  /\bno CRM\b/gi,
  /\b\d+(?:\.\d+)?K\s+followers\b/gi,
  /\b\d{2,}\s+followers\b/gi,
  /\b\d+\s+reviews\b/gi,
];

function addUniqueTerm(terms: string[], term: string | null | undefined): void {
  const cleaned = term?.replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length < 3) return;

  const normalized = cleaned.toLowerCase();
  if (!terms.some((existing) => existing.toLowerCase() === normalized)) {
    terms.push(cleaned);
  }
}

function buildBusinessSignalTerms(
  companyName: string | null,
  businessIntelligence: string | null,
): string[] {
  const terms: string[] = [];

  if (companyName) {
    addUniqueTerm(terms, companyName);
    const compactName = companyName
      .split(/[-|,]/)[0]
      ?.split(/\s+/)
      .filter((part) => part.length > 2)
      .slice(0, 3)
      .join(' ');
    addUniqueTerm(terms, compactName);
  }

  if (businessIntelligence) {
    for (const pattern of BUSINESS_SIGNAL_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of businessIntelligence.matchAll(pattern)) {
        addUniqueTerm(terms, match[0]);
      }
    }
  }

  return terms;
}

function buildMessageQualityOptions(
  companyName: string | null,
  businessIntelligence: string | null,
  redraftFeedback: string | null,
): MessageQualityOptions {
  const businessSignalTerms = buildBusinessSignalTerms(companyName, businessIntelligence);
  return {
    requireClosingQuestion: true,
    requireProfessionalGreeting: true,
    requireZbooniIntroAfterGreeting: true,
    requireZbooniTeamSignoff: true,
    businessSignalTerms,
    minBusinessSignalMatches: businessSignalTerms.length > 0 ? 1 : 0,
    ...(redraftFeedback ? { redraftFeedback } : {}),
  };
}

function isGenericEmailAddress(email: string | null | undefined): boolean {
  const localPart = email?.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? '';
  if (!localPart) return false;
  return GENERIC_EMAIL_PREFIXES.has(localPart);
}

function normalizeRecipientName(firstName: string, lastName: string): string | null {
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, ' ').trim();
  const normalized = fullName.toLowerCase();

  if (!fullName || normalized === 'unknown contact' || normalized === 'generic contact') {
    return null;
  }

  if (firstName.toLowerCase() === 'unknown' || lastName.toLowerCase() === 'contact') {
    return null;
  }

  return fullName;
}

function buildRecipientContext(lead: {
  firstName: string;
  lastName: string;
  email: string;
  businessEmail?: string | null | undefined;
  decisionMakerTitle?: string | null | undefined;
  decisionMakerPhone?: string | null | undefined;
}): RecipientContext {
  const recipientName = normalizeRecipientName(lead.firstName, lead.lastName);
  const title = lead.decisionMakerTitle?.replace(/\s+/g, ' ').trim() || null;
  const hasGenericPrimaryEmail = isGenericEmailAddress(lead.email);
  const primaryIsBusinessEmail = Boolean(
    lead.businessEmail &&
      lead.email.toLowerCase() === lead.businessEmail.toLowerCase(),
  );

  const recipientEmailKind: RecipientEmailKind =
    hasGenericPrimaryEmail || primaryIsBusinessEmail
      ? 'GENERIC'
      : lead.email.includes('@')
        ? 'PERSONAL'
        : 'UNKNOWN';

  const hasDecisionMakerSignal = Boolean(
    recipientName &&
      recipientEmailKind === 'PERSONAL' &&
      (title || lead.decisionMakerPhone || !hasGenericPrimaryEmail),
  );

  return {
    recipientType: hasDecisionMakerSignal ? 'DECISION_MAKER' : 'GENERIC_CONTACT',
    recipientName: hasDecisionMakerSignal ? recipientName : null,
    recipientTitle: hasDecisionMakerSignal ? title : null,
    recipientEmailKind,
  };
}

/**
 * Convert raw scrape JSON blobs (apifyWebsiteScrapeJson, apifyInstagramScrapeJson)
 * into structured, human-readable intelligence for message personalization.
 *
 * This replaces sending raw featuresJson (67 numbers) to OpenAI.
 * Instead, the AI gets actionable observations like:
 *   "Dubai Coffee Lounge uses Shopify but has no integrated payment solution"
 */
function buildMessageContext(
  websiteScrape: Record<string, unknown> | null,
  instagramScrape: Record<string, unknown> | null,
  companyName: string | null,
  preComputedInsights?: string | null | undefined,
): MessageContext {
  let companyInsight: string | null = null;
  let socialPresence: string | null = null;
  let techGap: string | null = null;
  let teamSignal: string | null = null;

  const company = companyName ?? 'the business';

  // ── Company Insight: tech stack gaps, payment setup, ordering method ──
  if (websiteScrape) {
    const insights: string[] = [];
    const technologies = websiteScrape.technologies as Record<string, unknown> | undefined;
    const hasShopify = websiteScrape.hasShopify === true;
    const hasWhatsApp = websiteScrape.hasWhatsApp === true;
    const paymentWidgets = Array.isArray(websiteScrape.paymentWidgets) ? websiteScrape.paymentWidgets as string[] : [];
    const hasPricingTiers = websiteScrape.hasPricingTiers === true;
    const hasProductCatalog = websiteScrape.hasProductCatalog === true;
    const detectedPlatforms = Array.isArray(websiteScrape.detectedPlatforms) ? websiteScrape.detectedPlatforms as string[] : [];

    if (hasShopify) {
      insights.push(`${company} uses Shopify for ecommerce`);
    } else if (detectedPlatforms.length > 0) {
      insights.push(`${company} runs on ${detectedPlatforms.slice(0, 2).join(' and ')}`);
    }

    if (hasWhatsApp && paymentWidgets.length === 0) {
      insights.push('takes WhatsApp orders but has no integrated payment solution');
    } else if (hasWhatsApp) {
      insights.push(`uses WhatsApp for sales with ${paymentWidgets.length} payment widget${paymentWidgets.length !== 1 ? 's' : ''}`);
    }

    if (hasPricingTiers) {
      insights.push('has tiered pricing (variable deal sizes)');
    }

    if (hasProductCatalog) {
      insights.push('has an online product catalog');
    }

    // Check for contact methods
    const contactInfo = websiteScrape.contactInfo as Record<string, unknown> | undefined;
    const emails = Array.isArray(contactInfo?.emails) ? contactInfo.emails as string[] : [];
    const phones = Array.isArray(contactInfo?.phones) ? contactInfo.phones as string[] : [];
    if (emails.length > 0 || phones.length > 0) {
      const contactParts: string[] = [];
      if (emails.length > 0) contactParts.push(`${emails.length} email${emails.length !== 1 ? 's' : ''}`);
      if (phones.length > 0) contactParts.push(`${phones.length} phone${phones.length !== 1 ? 's' : ''}`);
      insights.push(`${contactParts.join(' and ')} listed on the website`);
    }

    if (insights.length > 0) {
      companyInsight = insights.join('. ') + '.';
    }

    // ── Tech Gap: missing CRM, no live chat, basic analytics ──
    const gaps: string[] = [];
    const hasCrm = Array.isArray(technologies?.crm) && (technologies.crm as unknown[]).length > 0;
    const hasLiveChat = Array.isArray(technologies?.liveChat) && (technologies.liveChat as unknown[]).length > 0;
    const hasAnalytics = Array.isArray(technologies?.analytics) && (technologies.analytics as unknown[]).length > 0;

    if (!hasCrm) gaps.push('no CRM detected');
    if (!hasLiveChat) gaps.push('no live chat');
    if (!hasAnalytics) gaps.push('using basic or no analytics');
    else {
      const analyticsTools = technologies?.analytics as string[] | undefined;
      if (analyticsTools && analyticsTools.length === 1 && analyticsTools[0]?.toLowerCase().includes('google')) {
        gaps.push('basic Google Analytics only');
      }
    }

    if (gaps.length > 0) {
      techGap = gaps.join(', ') + '.';
    }

    // ── Team Signal: decision makers found on team page ──
    const decisionMakers = Array.isArray(websiteScrape.decisionMakers)
      ? websiteScrape.decisionMakers as Array<Record<string, unknown>>
      : [];
    if (decisionMakers.length > 0) {
      const names = decisionMakers
        .slice(0, 3)
        .map((dm) => {
          const name = typeof dm.name === 'string' ? dm.name : null;
          const title = typeof dm.title === 'string' ? dm.title : null;
          return name && title ? `${name} (${title})` : name ?? title;
        })
        .filter(Boolean);
      if (names.length > 0) {
        teamSignal = `Found on team page: ${names.join(', ')}.`;
      }
    }
  }

  // ── Social Presence: follower count, category, posting frequency ──
  if (instagramScrape) {
    const parts: string[] = [];
    const followerCount = typeof instagramScrape.followerCount === 'number' ? instagramScrape.followerCount : null;
    // Also check edge_followed_by format
    const edgeFollowedBy = instagramScrape.edge_followed_by as Record<string, unknown> | undefined;
    const effectiveFollowers = followerCount ?? (typeof edgeFollowedBy?.count === 'number' ? edgeFollowedBy.count : null);

    if (effectiveFollowers !== null) {
      const formatted = effectiveFollowers >= 1000
        ? `${(effectiveFollowers / 1000).toFixed(1)}K`
        : String(effectiveFollowers);
      parts.push(`${formatted} followers`);
    }

    const isVerified = instagramScrape.isVerified === true;
    if (isVerified) parts.push('verified account');

    const isBusinessAccount = instagramScrape.isBusinessAccount === true || instagramScrape.isProfessionalAccount === true;
    if (isBusinessAccount) parts.push('business account');

    const businessCategory = typeof instagramScrape.businessCategory === 'string' ? instagramScrape.businessCategory : null;
    if (businessCategory && businessCategory !== 'unknown') parts.push(businessCategory);

    const mediaCount = typeof instagramScrape.mediaCount === 'number' ? instagramScrape.mediaCount : null;
    if (mediaCount !== null) {
      // Rough estimate: posts per week based on account age (assume ~2 years if unknown)
      parts.push(`${mediaCount} posts`);
    }

    const engagementRate = typeof instagramScrape.engagementRate === 'number' ? instagramScrape.engagementRate : null;
    if (engagementRate !== null && engagementRate > 0) {
      parts.push(`${(engagementRate * 100).toFixed(1)}% engagement`);
    }

    // Include recent post themes if available
    const recentPosts = Array.isArray(instagramScrape.recentPosts)
      ? instagramScrape.recentPosts as Array<Record<string, unknown>>
      : [];
    if (recentPosts.length > 0) {
      const postThemes = recentPosts
        .filter(p => typeof p.caption === 'string' && (p.caption as string).length > 10)
        .slice(0, 2)
        .map(p => {
          const caption = (p.caption as string).slice(0, 80).replace(/\n/g, ' ');
          return `"${caption}..."`;
        });
      if (postThemes.length > 0) {
        parts.push(`recent posts about: ${postThemes.join(', ')}`);
      }
    }

    if (parts.length > 0) {
      socialPresence = parts.join(', ') + '.';
    }
  }

  // If pre-computed AI insights are available, prepend them to companyInsight
  if (preComputedInsights) {
    const cleanedInsights = sanitizeInsights(preComputedInsights);
    if (cleanedInsights.length > 0) {
      companyInsight = cleanedInsights + (companyInsight ? `\n${companyInsight}` : '');
    }
  }

  return { companyInsight, socialPresence, techGap, teamSignal };
}

function buildDraftGenerationFailureMessage(
  reason: string,
  forceRegenerate: boolean,
): string {
  return `${reason} ${forceRegenerate ? 'Your existing draft was kept.' : 'No draft was created.'}`;
}

async function setLeadDraftGenerationError(
  leadId: string,
  message: string,
  metadata?: Record<string, unknown> | undefined,
): Promise<void> {
  await Promise.allSettled([
    prisma.lead.updateMany({
      where: { id: leadId },
      data: { error: message },
    }),
    recordPipelineEvent({
      leadId,
      stage: 'message.generate',
      status: 'FAILED',
      metadata: {
        message,
        ...(metadata ?? {}),
      },
    }),
  ]);
}

async function clearLeadDraftGenerationError(leadId: string): Promise<void> {
  await prisma.lead.updateMany({
    where: { id: leadId },
    data: { error: null },
  });
}

async function notifyMessageDraftCreated(
  logger: MessageGenerateLogger,
  input: {
    leadId: string;
    icpProfileId: string;
    draftId: string;
    followUpNumber: number;
    forceRegenerate?: boolean | undefined;
    createdAt?: Date | undefined;
  },
): Promise<void> {
  const createdAt = input.createdAt instanceof Date ? input.createdAt : new Date();
  const payload = JSON.stringify({
    type: 'message_draft',
    status: 'CREATED',
    leadId: input.leadId,
    icpProfileId: input.icpProfileId,
    draftId: input.draftId,
    forceRegenerate: input.forceRegenerate,
    followUpNumber: input.followUpNumber,
    createdAt: createdAt.toISOString(),
  });

  try {
    await prisma.$executeRaw`select pg_notify(${MESSAGE_DRAFT_EVENTS_CHANNEL}, ${payload})`;
  } catch (error: unknown) {
    logger.warn(
      {
        leadId: input.leadId,
        draftId: input.draftId,
        error,
      },
      'Failed to publish message draft completion notification',
    );
  }
}

export async function handleMessageGenerateJob(
  logger: MessageGenerateLogger,
  job: Job<MessageGenerateJobPayload>,
  deps?: MessageGenerateJobDependencies,
): Promise<void> {
  const { runId, correlationId, leadId, icpProfileId, channel, promptVersion, knowledgeEntryIds } = job.data;
  const followUpNumber = job.data.followUpNumber ?? 0;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: correlationId ?? job.id,
      leadId,
      icpProfileId,
    },
    'Started message.generate job',
  );

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        businessEmail: true,
        phone: true,
        decisionMakerTitle: true,
        decisionMakerPhone: true,
        businessId: true,
        deletedAt: true,
        status: true,
      },
    });

    if (!lead) {
      logger.error({ jobId: job.id, leadId }, 'Lead not found for message generation');
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    if (lead.deletedAt) {
      logger.warn({ jobId: job.id, leadId }, 'Skipping soft-deleted lead');
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    const leadStatusEligibleForGeneration =
      followUpNumber === 0
        ? lead.status === 'qualified' || lead.status === 'drafted'
        : lead.status === 'messaged' || lead.status === 'replied';

    if (!leadStatusEligibleForGeneration) {
      logger.info(
        { jobId: job.id, leadId, leadStatus: lead.status, followUpNumber },
        'Lead is no longer in an eligible lifecycle state for message generation, skipping message.generate',
      );
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    // Cross-ICP dedup: skip if this lead already has an active message from a DIFFERENT ICP.
    // Follow-ups (followUpNumber > 0) are explicitly chained from the parent — skip dedup for them.
    if (followUpNumber === 0) {
      const existingDraft = await prisma.messageDraft.findFirst({
        where: {
          leadId,
          icpProfileId: { not: icpProfileId },
          approvalStatus: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] },
        },
        select: { id: true, icpProfileId: true, icpProfile: { select: { name: true } } },
      });

      if (existingDraft) {
        const icpName = existingDraft.icpProfile.name;
        logger.info(
          { jobId: job.id, leadId, existingDraftId: existingDraft.id, existingIcpProfileId: existingDraft.icpProfileId },
          `Lead already has active message from ICP ${icpName}, skipping`,
        );
        await tryFinalizeDiscoveryRun(runId, logger);
        return;
      }

      const existingSend = await prisma.messageSend.findFirst({
        where: {
          leadId,
          status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
          messageDraft: { icpProfileId: { not: icpProfileId } },
        },
        select: {
          id: true,
          messageDraft: {
            select: { icpProfileId: true, icpProfile: { select: { name: true } } },
          },
        },
      });

      if (existingSend) {
        const icpName = existingSend.messageDraft.icpProfile.name;
        logger.info(
          { jobId: job.id, leadId, existingSendId: existingSend.id, existingIcpProfileId: existingSend.messageDraft.icpProfileId },
          `Lead already has active message from ICP ${icpName}, skipping`,
        );
        await tryFinalizeDiscoveryRun(runId, logger);
        return;
      }
    }

    const latestScore = await prisma.leadScorePrediction.findFirst({
      where: { leadId, icpProfileId },
      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, scoreBand: true, blendedScore: true },
    });

    if (!latestScore) {
      logger.warn(
        { jobId: job.id, leadId, icpProfileId },
        'No current score is available for the requested ICP profile, skipping message.generate',
      );
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    const maybeEnqueueSendForAutoApprovedDraft = async (
      draft: {
        id: string;
        approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
        variants: Array<{
          id: string;
          channel: 'EMAIL' | 'WHATSAPP';
          isSelected: boolean;
        }>;
      },
    ): Promise<void> => {
      if (draft.approvalStatus !== 'AUTO_APPROVED') {
        return;
      }

      logger.warn(
        { jobId: job.id, draftId: draft.id, leadId, followUpNumber },
        'Auto-approved draft retained without enqueueing message.send because outbound sending is disabled',
      );
    };

    let qualificationThreshold: number;
    try {
      qualificationThreshold = await loadVerifiedScoreQualificationThreshold();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RetryableError(
        `Draft generation eligibility could not be verified: ${message}`,
        error,
      );
    }

    if (latestScore.blendedScore < qualificationThreshold) {
      logger.info(
        {
          jobId: job.id,
          leadId,
          icpProfileId,
          latestScoreId: latestScore.id,
          blendedScore: latestScore.blendedScore,
          qualificationThreshold,
        },
        'Lead is no longer eligible for draft generation, skipping message.generate',
      );
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    const existingDraftForRetry = await prisma.messageDraft.findFirst({
      where: {
        leadId,
        icpProfileId,
        followUpNumber,
        approvalStatus: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] },
      },
      include: { variants: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (existingDraftForRetry) {
      if (job.data.forceRegenerate) {
        const existingBlockingSend = await prisma.messageSend.findFirst({
          where: {
            messageDraftId: existingDraftForRetry.id,
            followUpNumber: 0,
            status: { in: ['QUEUED', 'SENDING', 'UNRESOLVED', 'SENT', 'DELIVERED', 'REPLIED', 'BOUNCED'] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });

        if (existingBlockingSend) {
          logger.info(
            { jobId: job.id, leadId, draftId: existingDraftForRetry.id, sendId: existingBlockingSend.id },
            'Existing initial send blocks regeneration, skipping',
          );
          await tryFinalizeDiscoveryRun(runId, logger);
          return;
        }
      } else {
        if (followUpNumber === 0 && lead.status === 'qualified') {
          await prisma.lead.updateMany({
            where: {
              id: leadId,
              status: 'qualified',
            },
            data: { status: 'drafted' },
          });
        }

        await maybeEnqueueSendForAutoApprovedDraft(existingDraftForRetry);

        logger.info(
          {
            jobId: job.id,
            leadId,
            draftId: existingDraftForRetry.id,
            followUpNumber,
            approvalStatus: existingDraftForRetry.approvalStatus,
          },
          'Existing message draft already present, skipping regeneration',
        );
        await tryFinalizeDiscoveryRun(runId, logger);
        return;
      }
    }

    const icpProfile = await prisma.icpProfile.findUnique({
      where: { id: icpProfileId },
      select: { name: true, description: true, featureList: true, metadataJson: true },
    });

    const latestSnapshot = await prisma.leadFeatureSnapshot.findFirst({
      where: { leadId, icpProfileId },
      orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const latestEnrichment = await prisma.leadEnrichmentRecord.findFirst({
      where: { leadId },
      orderBy: [{ enrichedAt: 'desc' }, { createdAt: 'desc' }],
      select: { normalizedPayload: true },
    });

    // Load Business record for scrape intelligence (message personalization)
    const business = lead.businessId
      ? await prisma.business.findUnique({
          where: { id: lead.businessId },
          select: { name: true, apifyWebsiteScrapeJson: true, apifyInstagramScrapeJson: true },
        })
      : null;

    // Load pre-computed AI business insights from BusinessConversion
    const businessConversion = lead.businessId
      ? await prisma.businessConversion.findFirst({
          where: {
            leadId,
            businessId: lead.businessId,
          },
          select: { businessInsights: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const preComputedInsights = businessConversion?.businessInsights ?? null;

    const featuresJson =
      latestSnapshot?.featuresJson && typeof latestSnapshot.featuresJson === 'object'
        ? (latestSnapshot.featuresJson as Record<string, unknown>)
        : {};

    const enrichmentPayload =
      latestEnrichment?.normalizedPayload && typeof latestEnrichment.normalizedPayload === 'object'
        ? (latestEnrichment.normalizedPayload as Record<string, unknown>)
        : null;

    const companyName =
      (typeof enrichmentPayload?.companyName === 'string' ? enrichmentPayload.companyName : null) ??
      (typeof enrichmentPayload?.company_name === 'string' ? enrichmentPayload.company_name : null) ??
      (business?.name ?? null);

    // Build structured business intelligence from scrape data
    const websiteScrape = business?.apifyWebsiteScrapeJson && typeof business.apifyWebsiteScrapeJson === 'object'
      ? business.apifyWebsiteScrapeJson as Record<string, unknown>
      : null;
    const instagramScrape = business?.apifyInstagramScrapeJson && typeof business.apifyInstagramScrapeJson === 'object'
      ? business.apifyInstagramScrapeJson as Record<string, unknown>
      : null;
    const messageContext = buildMessageContext(websiteScrape, instagramScrape, companyName, preComputedInsights);

    // Format for AI prompt — structured intelligence replaces raw feature numbers
    const intelligenceParts: string[] = [];
    if (messageContext.companyInsight) intelligenceParts.push(`Company: ${messageContext.companyInsight}`);
    if (messageContext.techGap) intelligenceParts.push(`Tech gaps: ${messageContext.techGap}`);
    if (messageContext.socialPresence) intelligenceParts.push(`Social: ${messageContext.socialPresence}`);
    if (messageContext.teamSignal) intelligenceParts.push(`Team: ${messageContext.teamSignal}`);
    const businessIntelligence = intelligenceParts.length > 0 ? intelligenceParts.join('\n') : null;
    const redraftFeedback =
      job.data.forceRegenerate && job.data.redraftFeedback?.trim()
        ? job.data.redraftFeedback.trim()
        : null;
    const messageQualityOptions = buildMessageQualityOptions(companyName, businessIntelligence, redraftFeedback);

    // Load custom messaging settings from PipelineSetting.
    const [behaviorPromptSetting, roleSetting, systemPromptSetting, modelSetting] = await Promise.all([
      getMessagingBehaviorPrompt(),
      getMessagingRole(),
      getMessagingSystemPrompt(),
      getMessagingModel(),
    ]);
    const customBehaviorPrompt = behaviorPromptSetting;
    const customRole = behaviorPromptSetting ? null : roleSetting;
    const customSystemPrompt = behaviorPromptSetting ? null : systemPromptSetting;
    const messagingModel = modelSetting;

    // Extract ICP metadata (sales hook, angle, messaging instructions)
    const icpMetadata = icpProfile?.metadataJson && typeof icpProfile.metadataJson === 'object'
      ? icpProfile.metadataJson as Record<string, unknown>
      : null;

    // Per-ICP messaging instructions from ICP metadataJson (Session A writes UI, we read)
    const messagingInstructions = typeof icpMetadata?.messagingInstructions === 'string'
      ? (icpMetadata.messagingInstructions.trim().length > 0 ? icpMetadata.messagingInstructions.trim() : null)
      : null;
    const icpHook = typeof icpMetadata?.salesHook === 'string'
      ? icpMetadata.salesHook
      : (typeof icpMetadata?.hook === 'string' ? icpMetadata.hook : null);
    const icpAngle = typeof icpMetadata?.angle === 'string'
      ? icpMetadata.angle
      : Array.isArray(icpMetadata?.angle)
        ? (icpMetadata.angle as unknown[]).filter((a): a is string => typeof a === 'string').join(', ')
        : null;

    const requiredIcpHook = icpHook && icpHook.trim().length > 0
      ? icpHook.trim()
      : (icpAngle && icpAngle.trim().length > 0
        ? icpAngle.trim()
        : (icpProfile?.description ? `Hook: ${icpProfile.description.split('.').at(0)?.trim()}` : null));
    const icpSegment = icpProfile?.name ?? null;
    // Sales hook debug: log what was extracted so we can verify hooks reach OpenAI
    logger.info(
      { jobId: job.id, leadId, icpProfileId, salesHook: requiredIcpHook ? requiredIcpHook.slice(0, 80) : '(none)', icpSegment },
      requiredIcpHook ? `Sales hook extracted: "${requiredIcpHook.slice(0, 50)}"` : 'No sales hook found for ICP',
    );
    if (!requiredIcpHook) {
      logger.warn({ jobId: job.id, leadId, icpProfileId }, 'ICP sales hook missing; message quality may degrade');
    }

    // Build featuresToPitch from ICP's featureList (used in initial + follow-up messages)
    const featuresToPitch: string[] = icpProfile?.featureList && Array.isArray(icpProfile.featureList)
      ? (icpProfile.featureList as string[]).filter((f) => typeof f === 'string' && f.trim().length > 0)
      : [];

    // Enrich icpDescription with featuresToPitch so the LLM knows which product features to reference
    let enrichedIcpDescription = icpProfile?.description ?? 'No ICP description available';
    if (featuresToPitch.length > 0) {
      enrichedIcpDescription += `\n\nKey features to pitch for this ICP segment:\n${featuresToPitch.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
    }

    const recipientContext = buildRecipientContext(lead);
    const previousDraftVariant = existingDraftForRetry?.variants[0] ?? null;

    const groundingContext = {
      leadName: `${lead.firstName} ${lead.lastName}`,
      leadEmail: lead.email,
      recipientType: recipientContext.recipientType,
      recipientName: recipientContext.recipientName,
      recipientTitle: recipientContext.recipientTitle,
      recipientEmailKind: recipientContext.recipientEmailKind,
      companyName: companyName ?? null,
      industry: (featuresJson.industry as string) ?? null,
      country: (featuresJson.country as string) ?? null,
      featuresJson,
      scoreBand: latestScore?.scoreBand ?? 'MEDIUM',
      blendedScore: latestScore?.blendedScore ?? 0,
      icpDescription: enrichedIcpDescription,
      businessIntelligence,
      icpHook: requiredIcpHook,
      icpAngle,
      redraftFeedback,
      customBehaviorPrompt,
      customRole,
      customSystemPrompt,
      messagingInstructions,
      previousDraftSubject: previousDraftVariant?.subject ?? null,
      previousDraftBody: previousDraftVariant?.bodyText ?? null,
      metadata: {
        hookUsed: requiredIcpHook ?? null,
        icpSegment,
        featuresToPitch: featuresToPitch.length > 0 ? featuresToPitch : null,
      },
    };

    const previouslyPitchedFeatures = job.data.previouslyPitchedFeatures ?? [];

    // Final approval state must come from current settings + current score, not
    // stale queued intent. If auto-approve settings cannot be loaded, the helper
    // safely defaults to disabled so the draft remains pending.
    const autoApproveConfig = await loadAutoApproveConfig();
    const blendedScore = latestScore?.blendedScore ?? 0;
    let autoApprove = shouldAutoApprove(autoApproveConfig, blendedScore);
    const manualApprovalOnly = await isManualApprovalOnlyEnabled();
    if (manualApprovalOnly) {
      autoApprove = false;
    }

    // Select feature to pitch for follow-ups
    let pitchedFeature: string | null = null;

    if (icpProfile?.featureList && Array.isArray(icpProfile.featureList)) {
      const featureList = icpProfile.featureList as string[];
      const available = featureList.filter((f) => !previouslyPitchedFeatures.includes(f));
      const candidates = available.length > 0 ? available : featureList; // wrap around if exhausted
      pitchedFeature = candidates[followUpNumber % candidates.length] ?? candidates[0] ?? null;
    }

    // Score-based channel selection:
    // HIGH (>=0.67) + has decision maker phone → WhatsApp
    // MEDIUM (0.3-0.67) → Email only
    // Explicit channel override takes priority
    let resolvedChannel = channel ?? 'EMAIL';

    if (!channel) {
      const blendedScore = latestScore?.blendedScore ?? 0;
      // Use decisionMakerPhone (from Apollo) over lead.phone (from Google)
      const hasDecisionMakerPhone = !!(lead.decisionMakerPhone && lead.decisionMakerPhone.trim() !== '');
      const hasPhone = hasDecisionMakerPhone || !!(lead.phone && lead.phone.trim() !== '');

      // Channel selection: phone available → WhatsApp, otherwise → Email.
      // Score tier bands are visual only — enrichment threshold upstream controls
      // who gets a phone lookup; here we just check the result.
      resolvedChannel = hasPhone ? 'WHATSAPP' : 'EMAIL';

      logger.info(
        { jobId: job.id, leadId, blendedScore, hasDecisionMakerPhone, hasPhone, resolvedChannel },
        'Phone-based channel selection',
      );
    }

    // Final phone validation: fall back to EMAIL if lead has no phone for WhatsApp
    if (resolvedChannel === 'WHATSAPP' && (!lead.phone || lead.phone.trim() === '')) {
      logger.info(
        { jobId: job.id, leadId },
        `Lead ${leadId} has no phone, falling back from WHATSAPP to EMAIL`,
      );
      resolvedChannel = 'EMAIL';
    }

    let generatedByModel = 'stub';
    let messageContent = { subject: null as string | null, bodyText: 'Message generation pending', bodyHtml: null as string | null, ctaText: null as string | null };

    // Build generateContext outside the if-block so NK retry can reference it
    let generateContext = { ...groundingContext, channel: resolvedChannel };
    if (!deps?.openAiAdapter?.isConfigured) {
      const failureMessage = buildDraftGenerationFailureMessage(
        'Draft generation failed because AI message generation is not configured.',
        Boolean(job.data.forceRegenerate),
      );
      logger.warn({ jobId: job.id, leadId }, 'OpenAI not configured for message generation');
      await setLeadDraftGenerationError(leadId, failureMessage, {
        failureType: 'provider_not_configured',
      });
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    let systemPromptOverride: string | undefined;

    if (followUpNumber > 0 && pitchedFeature) {
      systemPromptOverride = [
        'You are an expert B2B sales copywriter for Leadzilla.',
        `This is follow-up message #${followUpNumber} to a lead who has not replied.`,
        `Pitch this specific Leadzilla feature: ${pitchedFeature}`,
        previouslyPitchedFeatures.length > 0
          ? `Previous messages pitched: ${previouslyPitchedFeatures.join(', ')}. Do NOT repeat these.`
          : '',
        'Write a natural, conversational follow-up. Do not mention this is automated.',
        'Reference the previous outreach naturally ("I wanted to follow up..." / "One more thing I thought might interest you...").',
        'Generate a single message with: subject (null for WhatsApp), bodyText, bodyHtml (null ok), ctaText (null ok).',
      ].filter(Boolean).join(' ');
    }

    const generationBaseContext = { ...groundingContext, channel: resolvedChannel };
    generateContext = systemPromptOverride
      ? { ...generationBaseContext, icpDescription: systemPromptOverride }
      : generationBaseContext;

    const generateMessageVariants = (context: OpenAiMessageGenerationContext) =>
      messagingModel
        ? deps.openAiAdapter.generateMessageVariants(context, { model: messagingModel })
        : deps.openAiAdapter.generateMessageVariants(context);

    const result = await generateMessageVariants(generateContext);

    if (result.status !== 'success') {
      const failureMessage = buildDraftGenerationFailureMessage(
        result.status === 'retryable_error'
          ? 'Draft generation failed because the AI provider was temporarily unavailable.'
          : 'Draft generation failed because the AI provider returned an invalid response.',
        Boolean(job.data.forceRegenerate),
      );

      logger.warn(
        {
          jobId: job.id,
          leadId,
          status: result.status,
          providerMessage: result.failure.message,
          statusCode: result.failure.statusCode,
        },
        'OpenAI message generation failed without creating a draft',
      );

      await setLeadDraftGenerationError(leadId, failureMessage, {
        failureType: result.status,
        providerMessage: result.failure.message,
        statusCode: result.failure.statusCode,
      });

      if (result.status === 'retryable_error') {
        throw new RetryableError(failureMessage, result.failure);
      }

      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    generatedByModel = result.data.model;
    messageContent = ensureZbooniTeamSignoff(mergeCtaIntoBody(result.data.message));

    logger.info(
      { jobId: job.id, leadId, model: result.data.model },
      'OpenAI message generation succeeded',
    );

    let validation = validateMessageVariant(resolvedChannel, messageContent, messageQualityOptions);

    if (validation.reasons.length > 0) {
      logger.info(
        { jobId: job.id, leadId, reasons: validation.reasons },
        'Message validation findings',
      );
    }

    let validationAttempt = 1;
    while (validation.hardReject) {
      if (validationAttempt >= MESSAGE_VALIDATION_MAX_ATTEMPTS) {
        logger.warn(
          {
            jobId: job.id,
            leadId,
            attempts: validationAttempt,
            reasons: validation.reasons,
          },
          'Message validation failed after retry attempts; leaving existing draft untouched and retrying job',
        );
        throw new RetryableError(
          'Draft generation is retrying because the AI response did not pass message quality checks.',
          { reasons: validation.reasons, attempts: validationAttempt },
        );
      }

      logger.warn(
        {
          jobId: job.id,
          leadId,
          attempt: validationAttempt + 1,
          maxAttempts: MESSAGE_VALIDATION_MAX_ATTEMPTS,
          reasons: validation.reasons,
        },
        'Message validation failed, retrying with validator feedback',
      );

      const stricterSuffix = buildStricterPromptSuffix(resolvedChannel, validation.reasons);
      const retryContext = {
        ...generateContext,
        icpDescription: [
          generateContext.icpDescription,
          '',
          `MESSAGE QUALITY RETRY ${validationAttempt + 1}/${MESSAGE_VALIDATION_MAX_ATTEMPTS}:`,
          stricterSuffix,
        ].join('\n'),
      };

      const retryResult = await generateMessageVariants(retryContext);

      if (retryResult.status === 'success') {
        generatedByModel = retryResult.data.model;
        const retryMessageContent = ensureZbooniTeamSignoff(mergeCtaIntoBody(retryResult.data.message));
        messageContent = retryMessageContent;
        validation = validateMessageVariant(resolvedChannel, messageContent, messageQualityOptions);
        validationAttempt++;

        if (validation.reasons.length > 0) {
          logger.info(
            { jobId: job.id, leadId, reasons: validation.reasons },
            'Message validation findings',
          );
        }
      } else {
        if (retryResult.status === 'retryable_error') {
          throw new RetryableError(
            'Draft generation retry failed because the AI provider was temporarily unavailable.',
            retryResult.failure,
          );
        }

        const failureMessage = buildDraftGenerationFailureMessage(
          'Draft generation failed because the AI provider returned an invalid response.',
          Boolean(job.data.forceRegenerate),
        );
        await setLeadDraftGenerationError(leadId, failureMessage, {
          failureType: retryResult.status,
          providerStatus: retryResult.status,
          providerMessage: retryResult.failure.message,
          statusCode: retryResult.failure.statusCode,
        });
        await tryFinalizeDiscoveryRun(runId, logger);
        return;
      }
    }

    messageContent = validation.cleaned;

    // -----------------------------------------------------------------------
    // Negative keyword filter — catch Leadzilla ICP disqualification signals
    // Runs after validation/cleaning, before persisting to DB.
    // -----------------------------------------------------------------------
    const nkCheck = checkNegativeKeywords(messageContent.bodyText);

    if (nkCheck.found) {
      logger.warn(
        { jobId: job.id, leadId, keywords: nkCheck.matches },
        'Negative keywords detected in generated message, attempting regeneration',
      );

      const nkPromptSuffix = buildNegativeKeywordPromptSuffix(nkCheck.matches);
      const nkRetryContext = {
        ...generateContext,
        icpDescription: `${generateContext.icpDescription}\n\n${nkPromptSuffix}`,
      };

      const nkRetryResult = await generateMessageVariants(nkRetryContext);

      if (nkRetryResult.status === 'success') {
        generatedByModel = nkRetryResult.data.model;
        const retryMessageContent = ensureZbooniTeamSignoff(mergeCtaIntoBody(nkRetryResult.data.message));
        const nkValidation = validateMessageVariant(resolvedChannel, retryMessageContent, messageQualityOptions);
        const nkRecheck = checkNegativeKeywords(nkValidation.cleaned.bodyText);

        if (nkValidation.hardReject || nkRecheck.found) {
          const failureMessage = buildDraftGenerationFailureMessage(
            'Draft generation failed because the AI response violated message safety rules.',
            Boolean(job.data.forceRegenerate),
          );
          await setLeadDraftGenerationError(leadId, failureMessage, {
            failureType: 'negative_keywords',
            keywords: nkRecheck.matches,
            reasons: nkValidation.reasons,
          });
          await tryFinalizeDiscoveryRun(runId, logger);
          return;
        }

        messageContent = nkValidation.cleaned;
      } else {
        const failureMessage = buildDraftGenerationFailureMessage(
          'Draft generation failed because the AI response violated message safety rules.',
          Boolean(job.data.forceRegenerate),
        );
        await setLeadDraftGenerationError(leadId, failureMessage, {
          failureType: 'negative_keyword_retry_failed',
          keywords: nkCheck.matches,
          providerStatus: nkRetryResult.status,
          providerMessage: nkRetryResult.failure.message,
          statusCode: nkRetryResult.failure.statusCode,
        });
        await tryFinalizeDiscoveryRun(runId, logger);
        return;
      }
    }

    // Guard: if body looks like raw JSON or leaked JSON fragment, fail honestly.
    if (
      /^\s*\{[\s\S]*\}\s*$/.test(messageContent.bodyText.trim()) ||
      messageContent.bodyText.includes('{"insights"') ||
      messageContent.bodyText.includes('{"message"') ||
      /```json/i.test(messageContent.bodyText)
    ) {
      const failureMessage = buildDraftGenerationFailureMessage(
        'Draft generation failed because the AI returned invalid structured output instead of a usable message.',
        Boolean(job.data.forceRegenerate),
      );
      logger.warn(
        { jobId: job.id, leadId },
        'Message body contains raw JSON, failing without creating a draft',
      );
      await setLeadDraftGenerationError(leadId, failureMessage, {
        failureType: 'raw_json_output',
      });
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    const draft = await prisma.$transaction(async (tx) => {
      if (job.data.forceRegenerate && existingDraftForRetry) {
        await tx.messageDraft.update({
          where: { id: existingDraftForRetry.id },
          data: {
            approvalStatus: 'REJECTED',
            rejectedReason: 'Superseded by regenerated draft',
            approvedByUserId: null,
            approvedAt: null,
          },
        });
      }

      return tx.messageDraft.create({
        data: {
          leadId,
          icpProfileId,
          scorePredictionId: latestScore.id,
          promptVersion: promptVersion ?? 'v1',
          generatedByModel,
          groundingKnowledgeIds: knowledgeEntryIds ?? [],
          groundingContextJson: toInputJson(groundingContext),
          approvalStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING',
          followUpNumber,
          pitchedFeature,
          parentMessageSendId: job.data.parentMessageSendId ?? null,
          variants: {
            create: [
              {
                variantKey: 'variant_a',
                channel: resolvedChannel,
                subject: messageContent.subject,
                bodyText: messageContent.bodyText,
                bodyHtml: messageContent.bodyHtml,
                ctaText: messageContent.ctaText,
                isSelected: autoApprove,
              },
            ],
          },
        },
        include: { variants: true },
      });
    });

    await clearLeadDraftGenerationError(leadId);

    // If a retry reuses an existing initial draft after draft creation already
    // succeeded, restore the canonical drafted state without downgrading later
    // lifecycle states such as messaged/replied/cold.
    if (followUpNumber === 0 && lead.status === 'qualified') {
      await prisma.lead.updateMany({
        where: {
          id: leadId,
          status: 'qualified',
        },
        data: { status: 'drafted' },
      });
    }

    await maybeEnqueueSendForAutoApprovedDraft(draft);

    await notifyMessageDraftCreated(logger, {
      leadId,
      icpProfileId,
      draftId: draft.id,
      followUpNumber,
      forceRegenerate: job.data.forceRegenerate,
      createdAt: draft.createdAt,
    });

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        leadId,
        draftId: draft.id,
        generatedByModel,
        variantCount: draft.variants.length,
      },
      'Completed message.generate job',
    );

    // Check if this was the last lead for a discovery run pipeline
    await tryFinalizeDiscoveryRun(runId, logger);
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
      'Failed message.generate job',
    );

    throw classifyError(error);
  }
}
  const sanitizeInsights = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof parsed.insights === 'string' && parsed.insights.trim().length > 0) {
          return parsed.insights.trim();
        }
      } catch {
        // keep original text fallback
      }
    }
    return value.replace(/```json[\s\S]*?```/gi, '').trim();
  };
