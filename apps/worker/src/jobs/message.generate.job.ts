import type { GenerateMessageDraftRequest } from '@lead-flood/contracts';
import { prisma, toInputJson } from '@lead-flood/db';
import type { OpenAiAdapter } from '@lead-flood/providers';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';
import { loadAutoApproveConfig, shouldAutoApprove } from '../utils/pipeline-settings.js';

import {
  validateMessageVariant,
  buildStricterPromptSuffix,
  checkNegativeKeywords,
  buildNegativeKeywordPromptSuffix,
} from '../messaging/validate-message.js';
import { getFallbackForChannel, type MessageContext } from '../messaging/fallback-templates.js';
import { MESSAGE_SEND_JOB_NAME, MESSAGE_SEND_RETRY_OPTIONS, type MessageSendJobPayload } from './message.send.job.js';

export const MESSAGE_GENERATE_JOB_NAME = 'message.generate';
export const MESSAGE_GENERATE_IDEMPOTENCY_KEY_PATTERN =
  'message.generate:${leadId}:${scorePredictionId}';

export const MESSAGE_GENERATE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 45,
  retryBackoff: true,
  deadLetter: 'message.generate.dead_letter',
};

export interface MessageGenerateJobPayload
  extends Pick<
    GenerateMessageDraftRequest,
    'leadId' | 'icpProfileId' | 'scorePredictionId' | 'knowledgeEntryIds' | 'promptVersion'
  >,
    Partial<Pick<GenerateMessageDraftRequest, 'channel'>> {
  runId: string;
  correlationId?: string | undefined;
  followUpNumber?: number | undefined;
  parentMessageSendId?: string | undefined;
  previouslyPitchedFeatures?: string[] | undefined;
  autoApprove?: boolean | undefined;
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
    companyInsight = preComputedInsights + (companyInsight ? `\n${companyInsight}` : '');
  }

  return { companyInsight, socialPresence, techGap, teamSignal };
}

export async function handleMessageGenerateJob(
  logger: MessageGenerateLogger,
  job: Job<MessageGenerateJobPayload>,
  deps?: MessageGenerateJobDependencies,
): Promise<void> {
  const { runId, correlationId, leadId, icpProfileId, scorePredictionId, channel, promptVersion, knowledgeEntryIds } = job.data;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: correlationId ?? job.id,
      leadId,
      icpProfileId,
      scorePredictionId,
    },
    'Started message.generate job',
  );

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true, decisionMakerPhone: true, businessId: true, deletedAt: true },
    });

    if (!lead) {
      logger.error({ jobId: job.id, leadId }, 'Lead not found for message generation');
      return;
    }

    if (lead.deletedAt) {
      logger.warn({ jobId: job.id, leadId }, 'Skipping soft-deleted lead');
      return;
    }

    // Cross-ICP dedup: skip if this lead already has an active message from a DIFFERENT ICP.
    // Follow-ups (followUpNumber > 0) are explicitly chained from the parent — skip dedup for them.
    const followUpNumber = job.data.followUpNumber ?? 0;
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
        return;
      }
    }

    const icpProfile = await prisma.icpProfile.findUnique({
      where: { id: icpProfileId },
      select: { description: true, featureList: true, metadataJson: true },
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
          where: { leadId },
          select: { businessInsights: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    const preComputedInsights = businessConversion?.businessInsights ?? null;

    const latestScore = scorePredictionId
      ? await prisma.leadScorePrediction.findUnique({
          where: { id: scorePredictionId },
        })
      : await prisma.leadScorePrediction.findFirst({
          where: { leadId, icpProfileId },
          orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
        });

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

    // Load custom messaging settings from PipelineSetting (role, system prompt, instructions)
    const [roleSetting, systemPromptSetting, instrSetting] = await Promise.all([
      prisma.pipelineSetting.findUnique({ where: { key: 'messagingRole' } }),
      prisma.pipelineSetting.findUnique({ where: { key: 'messagingSystemPrompt' } }),
      prisma.pipelineSetting.findUnique({ where: { key: 'messagingInstructions' } }),
    ]);
    const customRole = typeof roleSetting?.valueJson === 'string' ? roleSetting.valueJson : null;
    const customSystemPrompt = typeof systemPromptSetting?.valueJson === 'string' ? systemPromptSetting.valueJson : null;
    const messagingInstructions = typeof instrSetting?.valueJson === 'string' ? instrSetting.valueJson : null;

    // Extract ICP sales hook + angle from metadataJson
    const icpMetadata = icpProfile?.metadataJson && typeof icpProfile.metadataJson === 'object'
      ? icpProfile.metadataJson as Record<string, unknown>
      : null;
    const icpHook = typeof icpMetadata?.hook === 'string' ? icpMetadata.hook : null;
    const icpAngle = typeof icpMetadata?.angle === 'string'
      ? icpMetadata.angle
      : Array.isArray(icpMetadata?.angle)
        ? (icpMetadata.angle as unknown[]).filter((a): a is string => typeof a === 'string').join(', ')
        : null;

    const groundingContext = {
      leadName: `${lead.firstName} ${lead.lastName}`,
      leadEmail: lead.email,
      companyName: companyName ?? null,
      industry: (featuresJson.industry as string) ?? null,
      country: (featuresJson.country as string) ?? null,
      featuresJson,
      scoreBand: latestScore?.scoreBand ?? 'MEDIUM',
      blendedScore: latestScore?.blendedScore ?? 0,
      icpDescription: icpProfile?.description ?? 'No ICP description available',
      businessIntelligence,
      icpHook,
      icpAngle,
      customRole,
      customSystemPrompt,
      messagingInstructions,
    };

    const previouslyPitchedFeatures = job.data.previouslyPitchedFeatures ?? [];

    // Auto-approve: if payload has explicit value, use it; otherwise compute from PipelineSetting
    let autoApprove: boolean;
    if (job.data.autoApprove !== undefined) {
      autoApprove = job.data.autoApprove;
    } else {
      const autoApproveConfig = await loadAutoApproveConfig();
      const blendedScore = latestScore?.blendedScore ?? 0;
      autoApprove = shouldAutoApprove(autoApproveConfig, blendedScore);
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

      if (blendedScore >= 0.67 && hasPhone) {
        resolvedChannel = 'WHATSAPP';
      } else {
        resolvedChannel = 'EMAIL';
      }

      logger.info(
        { jobId: job.id, leadId, blendedScore, hasDecisionMakerPhone, hasPhone, resolvedChannel },
        'Score-based channel selection',
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
    let generateContext = groundingContext;

    if (deps?.openAiAdapter?.isConfigured) {
      let systemPromptOverride: string | undefined;

      if (followUpNumber > 0 && pitchedFeature) {
        systemPromptOverride = [
          'You are an expert B2B sales copywriter for Zbooni, a UAE fintech company.',
          `This is follow-up message #${followUpNumber} to a lead who has not replied.`,
          `Pitch this specific Zbooni feature: ${pitchedFeature}`,
          previouslyPitchedFeatures.length > 0
            ? `Previous messages pitched: ${previouslyPitchedFeatures.join(', ')}. Do NOT repeat these.`
            : '',
          'Write a natural, conversational follow-up. Do not mention this is automated.',
          'Reference the previous outreach naturally ("I wanted to follow up..." / "One more thing I thought might interest you...").',
          'Generate a single message with: subject (null for WhatsApp), bodyText, bodyHtml (null ok), ctaText (null ok).',
        ].filter(Boolean).join(' ');
      }

      generateContext = systemPromptOverride
        ? { ...groundingContext, icpDescription: systemPromptOverride }
        : groundingContext;

      // First attempt
      const result = await deps.openAiAdapter.generateMessageVariants(generateContext);

      if (result.status === 'success') {
        generatedByModel = result.data.model;
        messageContent = result.data.message;

        logger.info(
          { jobId: job.id, leadId, model: result.data.model },
          'OpenAI message generation succeeded',
        );
      } else {
        logger.warn(
          { jobId: job.id, leadId, status: result.status },
          'OpenAI message generation failed — using fallback templates',
        );
      }

      // Validate the message
      const validation = validateMessageVariant(resolvedChannel, messageContent);

      if (validation.reasons.length > 0) {
        logger.info(
          { jobId: job.id, leadId, reasons: validation.reasons },
          'Message validation findings',
        );
      }

      // If hard rejection, retry once with stricter prompt
      if (validation.hardReject) {
        logger.warn(
          { jobId: job.id, leadId },
          'Hard rejection detected, retrying with stricter prompt',
        );

        const stricterSuffix = buildStricterPromptSuffix(resolvedChannel);
        const retryContext = {
          ...generateContext,
          icpDescription: `${generateContext.icpDescription}\n\n${stricterSuffix}`,
        };

        const retryResult = await deps.openAiAdapter.generateMessageVariants(retryContext);

        if (retryResult.status === 'success') {
          generatedByModel = retryResult.data.model;
          const retryValidation = validateMessageVariant(resolvedChannel, retryResult.data.message);

          if (!retryValidation.hardReject) {
            messageContent = retryValidation.cleaned;
          } else {
            // Still hard rejecting after retry — use fallback
            logger.warn(
              { jobId: job.id, leadId },
              'Retry still has hard rejection, using fallback template',
            );
            messageContent = getFallbackForChannel(resolvedChannel, lead.firstName, companyName, messageContext);
            generatedByModel = 'fallback-template';
          }
        } else {
          // Retry OpenAI call itself failed — use fallback
          logger.warn({ jobId: job.id, leadId }, 'Retry OpenAI failed, using fallback template');
          messageContent = getFallbackForChannel(resolvedChannel, lead.firstName, companyName, messageContext);
          generatedByModel = 'fallback-template';
        }
      } else {
        // No hard rejection — apply soft cleaning
        messageContent = validation.cleaned;
      }
    } else {
      // OpenAI not configured — use fallback
      logger.warn({ jobId: job.id, leadId }, 'OpenAI not configured, using fallback template');
      messageContent = getFallbackForChannel(resolvedChannel, lead.firstName, companyName, messageContext);
      generatedByModel = 'fallback-template';
    }

    // -----------------------------------------------------------------------
    // Negative keyword filter — catch Zbooni ICP disqualification signals
    // Runs after validation/cleaning, before persisting to DB.
    // -----------------------------------------------------------------------
    if (deps?.openAiAdapter?.isConfigured && generatedByModel !== 'fallback-template') {
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

        const nkRetryResult = await deps.openAiAdapter.generateMessageVariants(nkRetryContext);

        if (nkRetryResult.status === 'success') {
          generatedByModel = nkRetryResult.data.model;
          const nkRecheck = checkNegativeKeywords(nkRetryResult.data.message.bodyText);

          if (!nkRecheck.found) {
            messageContent = nkRetryResult.data.message;
          } else {
            logger.warn(
              { jobId: job.id, leadId, keywords: nkRecheck.matches },
              'Message still contains negative keywords after regeneration, proceeding anyway',
            );
          }
        } else {
          logger.warn(
            { jobId: job.id, leadId, status: nkRetryResult.status },
            'Negative keyword regeneration failed, proceeding with original message',
          );
        }
      }
    }

    // Guard: if body looks like raw JSON, replace with fallback
    if (
      messageContent.bodyText.trim().startsWith('{') &&
      (messageContent.bodyText.includes('"insights"') || messageContent.bodyText.includes('"message"'))
    ) {
      logger.warn(
        { jobId: job.id, leadId },
        'Message body contains raw JSON, replacing with fallback template',
      );
      messageContent = getFallbackForChannel(resolvedChannel, lead.firstName, companyName, messageContext);
      generatedByModel = 'fallback-template';
    }

    // Idempotent draft creation: if a draft already exists for this lead+ICP+followUp
    // combination (e.g. from a retry), reuse it instead of creating a duplicate.
    const existingDraftForRetry = await prisma.messageDraft.findFirst({
      where: { leadId, icpProfileId, followUpNumber },
      include: { variants: true },
      orderBy: { createdAt: 'desc' },
    });

    const draft = existingDraftForRetry ?? await prisma.messageDraft.create({
      data: {
        leadId,
        icpProfileId,
        scorePredictionId: scorePredictionId ?? latestScore?.id ?? null,
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

    // Set lead status to 'drafted' if this is the initial message (not a follow-up)
    if (followUpNumber === 0 && !existingDraftForRetry) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: 'drafted' },
      });
    }

    // Auto-send for follow-ups
    if (autoApprove && deps?.boss) {
      const selectedVariant = draft.variants[0];
      if (selectedVariant) {
        // Idempotent: skip if MessageSend already exists for this draft (crash-retry safety)
        const existingSendForDraft = await prisma.messageSend.findFirst({
          where: { messageDraftId: draft.id },
        });
        if (existingSendForDraft) {
          logger.info(
            { jobId: job.id, sendId: existingSendForDraft.id, draftId: draft.id },
            'MessageSend already exists for draft, skipping',
          );
          return;
        }

        const sendRecord = await prisma.messageSend.create({
          data: {
            leadId,
            messageDraftId: draft.id,
            messageVariantId: selectedVariant.id,
            channel: selectedVariant.channel,
            provider: selectedVariant.channel === 'WHATSAPP' ? 'TRENGO' : 'RESEND',
            status: 'QUEUED',
            idempotencyKey: `followup:${leadId}:${draft.id}:${selectedVariant.id}`,
            followUpNumber,
          },
        });

        await deps.boss.send(
          MESSAGE_SEND_JOB_NAME,
          {
            runId: `message.send:${sendRecord.id}`,
            sendId: sendRecord.id,
            messageDraftId: draft.id,
            messageVariantId: selectedVariant.id,
            idempotencyKey: sendRecord.idempotencyKey,
            channel: selectedVariant.channel,
            followUpNumber,
            correlationId: correlationId ?? job.id,
          } satisfies MessageSendJobPayload,
          {
            singletonKey: `message.send:${sendRecord.id}`,
            ...MESSAGE_SEND_RETRY_OPTIONS,
          },
        );

        logger.info(
          { jobId: job.id, draftId: draft.id, sendId: sendRecord.id, followUpNumber },
          'Auto-approved follow-up, enqueued message.send',
        );
      }
    }

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
