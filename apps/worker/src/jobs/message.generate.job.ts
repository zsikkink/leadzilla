import type { GenerateMessageDraftRequest } from '@lead-flood/contracts';
import { type Prisma, prisma } from '@lead-flood/db';
import type { OpenAiAdapter } from '@lead-flood/providers';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import {
  validateMessageVariant,
  buildStricterPromptSuffix,
  checkNegativeKeywords,
  buildNegativeKeywordPromptSuffix,
} from '../messaging/validate-message.js';
import { getFallbackForChannel } from '../messaging/fallback-templates.js';
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
    'leadId' | 'icpProfileId' | 'scorePredictionId' | 'knowledgeEntryIds' | 'channel' | 'promptVersion'
  > {
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

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/**
 * Deterministically assign A/B variant based on leadId hash.
 * Uses a simple string hash to split leads ~50/50 between variant_a and variant_b.
 */
export function assignAbVariant(leadId: string): 'variant_a' | 'variant_b' {
  let hash = 0;
  for (let i = 0; i < leadId.length; i++) {
    const char = leadId.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return (hash & 1) === 0 ? 'variant_a' : 'variant_b';
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
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });

    if (!lead) {
      logger.error({ jobId: job.id, leadId }, 'Lead not found for message generation');
      return;
    }

    // Cross-ICP dedup: skip if this lead already has an active message from ANY ICP
    const existingDraft = await prisma.messageDraft.findFirst({
      where: {
        leadId,
        approvalStatus: { in: ['PENDING', 'APPROVED', 'AUTO_APPROVED'] },
      },
      select: { id: true, icpProfileId: true, icpProfile: { select: { name: true } } },
    });

    if (!existingDraft) {
      const existingSend = await prisma.messageSend.findFirst({
        where: {
          leadId,
          status: { in: ['QUEUED', 'SENT', 'DELIVERED'] },
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
    } else {
      const icpName = existingDraft.icpProfile.name;
      logger.info(
        { jobId: job.id, leadId, existingDraftId: existingDraft.id, existingIcpProfileId: existingDraft.icpProfileId },
        `Lead already has active message from ICP ${icpName}, skipping`,
      );
      return;
    }

    const icpProfile = await prisma.icpProfile.findUnique({
      where: { id: icpProfileId },
      select: { description: true, featureList: true },
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
      (typeof enrichmentPayload?.company_name === 'string' ? enrichmentPayload.company_name : null);

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
    };

    const followUpNumber = job.data.followUpNumber ?? 0;
    const previouslyPitchedFeatures = job.data.previouslyPitchedFeatures ?? [];
    const autoApprove = job.data.autoApprove ?? false;

    // Select feature to pitch for follow-ups
    let pitchedFeature: string | null = null;

    if (icpProfile?.featureList && Array.isArray(icpProfile.featureList)) {
      const featureList = icpProfile.featureList as string[];
      const available = featureList.filter((f) => !previouslyPitchedFeatures.includes(f));
      const candidates = available.length > 0 ? available : featureList; // wrap around if exhausted
      pitchedFeature = candidates[followUpNumber % candidates.length] ?? candidates[0] ?? null;
    }

    let resolvedChannel = channel ?? 'WHATSAPP';

    // Phone validation: fall back to EMAIL if lead has no phone for WhatsApp
    if (resolvedChannel === 'WHATSAPP' && (!lead.phone || lead.phone.trim() === '')) {
      logger.info(
        { jobId: job.id, leadId },
        `Lead ${leadId} has no phone, falling back from WHATSAPP to EMAIL`,
      );
      resolvedChannel = 'EMAIL';
    }

    let generatedByModel = 'stub';
    let variantAContent = { subject: null as string | null, bodyText: 'Message generation pending', bodyHtml: null as string | null, ctaText: null as string | null };
    let variantBContent = { ...variantAContent };

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
          'Generate two variants: variant_a (more direct) and variant_b (more casual).',
          'Each variant must have: subject (null for WhatsApp), bodyText, bodyHtml (null ok), ctaText (null ok).',
        ].filter(Boolean).join(' ');
      }

      const generateContext = systemPromptOverride
        ? { ...groundingContext, icpDescription: systemPromptOverride }
        : groundingContext;

      // First attempt
      const result = await deps.openAiAdapter.generateMessageVariants(generateContext);

      if (result.status === 'success') {
        generatedByModel = result.data.model;
        variantAContent = result.data.variant_a;
        variantBContent = result.data.variant_b;
      } else {
        logger.warn(
          { jobId: job.id, leadId, status: result.status },
          'OpenAI message generation failed, creating stub draft',
        );
      }

      // Validate both variants
      const validationA = validateMessageVariant(resolvedChannel, variantAContent);
      const validationB = validateMessageVariant(resolvedChannel, variantBContent);

      if (validationA.reasons.length > 0 || validationB.reasons.length > 0) {
        logger.info(
          { jobId: job.id, leadId, reasonsA: validationA.reasons, reasonsB: validationB.reasons },
          'Message validation findings',
        );
      }

      // If either has a hard rejection, retry once with stricter prompt
      if (validationA.hardReject || validationB.hardReject) {
        logger.warn(
          { jobId: job.id, leadId, hardRejectA: validationA.hardReject, hardRejectB: validationB.hardReject },
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
          const retryA = validateMessageVariant(resolvedChannel, retryResult.data.variant_a);
          const retryB = validateMessageVariant(resolvedChannel, retryResult.data.variant_b);

          if (!retryA.hardReject) {
            variantAContent = retryA.cleaned;
          }
          if (!retryB.hardReject) {
            variantBContent = retryB.cleaned;
          }

          // If still hard rejecting after retry, use fallback
          if (retryA.hardReject || retryB.hardReject) {
            logger.warn(
              { jobId: job.id, leadId },
              'Retry still has hard rejections, using fallback templates',
            );
            const fallback = getFallbackForChannel(
              resolvedChannel,
              lead.firstName,
              companyName,
            );
            generatedByModel = 'fallback-template';
            if (retryA.hardReject) {
              variantAContent = fallback;
            }
            if (retryB.hardReject) {
              variantBContent = fallback;
            }
          }
        } else {
          // Retry OpenAI call itself failed — use fallback for both
          logger.warn({ jobId: job.id, leadId }, 'Retry OpenAI failed, using fallback templates');
          const fallback = getFallbackForChannel(resolvedChannel, lead.firstName, companyName);
          generatedByModel = 'fallback-template';
          variantAContent = fallback;
          variantBContent = fallback;
        }
      } else {
        // No hard rejections — apply soft cleaning
        variantAContent = validationA.cleaned;
        variantBContent = validationB.cleaned;
      }
    } else {
      // OpenAI not configured — use fallback
      logger.warn({ jobId: job.id, leadId }, 'OpenAI not configured, using fallback templates');
      const fallback = getFallbackForChannel(resolvedChannel, lead.firstName, companyName);
      generatedByModel = 'fallback-template';
      variantAContent = fallback;
      variantBContent = fallback;
    }

    // -----------------------------------------------------------------------
    // Negative keyword filter — catch Zbooni ICP disqualification signals
    // Runs after validation/cleaning, before persisting to DB.
    // -----------------------------------------------------------------------
    if (deps?.openAiAdapter?.isConfigured && generatedByModel !== 'fallback-template') {
      const nkCheckA = checkNegativeKeywords(variantAContent.bodyText);
      const nkCheckB = checkNegativeKeywords(variantBContent.bodyText);

      const allFoundKeywords = [...new Set([...nkCheckA.matches, ...nkCheckB.matches])];

      if (allFoundKeywords.length > 0) {
        logger.warn(
          {
            jobId: job.id,
            leadId,
            variantAKeywords: nkCheckA.matches,
            variantBKeywords: nkCheckB.matches,
          },
          'Negative keywords detected in generated variants, attempting regeneration',
        );

        const nkPromptSuffix = buildNegativeKeywordPromptSuffix(allFoundKeywords);
        const nkRetryContext = {
          ...groundingContext,
          icpDescription: `${groundingContext.icpDescription}\n\n${nkPromptSuffix}`,
        };

        const nkRetryResult = await deps.openAiAdapter.generateMessageVariants(nkRetryContext);

        if (nkRetryResult.status === 'success') {
          generatedByModel = nkRetryResult.data.model;
          const retryVarA = nkRetryResult.data.variant_a;
          const retryVarB = nkRetryResult.data.variant_b;

          const nkRecheckA = checkNegativeKeywords(retryVarA.bodyText);
          const nkRecheckB = checkNegativeKeywords(retryVarB.bodyText);

          if (!nkRecheckA.found) {
            variantAContent = retryVarA;
          } else {
            logger.warn(
              { jobId: job.id, leadId, keywords: nkRecheckA.matches },
              'Variant A still contains negative keywords after regeneration, proceeding anyway',
            );
          }

          if (!nkRecheckB.found) {
            variantBContent = retryVarB;
          } else {
            logger.warn(
              { jobId: job.id, leadId, keywords: nkRecheckB.matches },
              'Variant B still contains negative keywords after regeneration, proceeding anyway',
            );
          }
        } else {
          logger.warn(
            { jobId: job.id, leadId, status: nkRetryResult.status },
            'Negative keyword regeneration failed, proceeding with original variants',
          );
        }
      }
    }

    // Deterministically select A/B variant for this lead
    const selectedVariantKey = assignAbVariant(leadId);

    const draft = await prisma.messageDraft.create({
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
              subject: variantAContent.subject,
              bodyText: variantAContent.bodyText,
              bodyHtml: variantAContent.bodyHtml,
              ctaText: variantAContent.ctaText,
              isSelected: autoApprove && selectedVariantKey === 'variant_a',
            },
            {
              variantKey: 'variant_b',
              channel: resolvedChannel,
              subject: variantBContent.subject,
              bodyText: variantBContent.bodyText,
              bodyHtml: variantBContent.bodyHtml,
              ctaText: variantBContent.ctaText,
              isSelected: autoApprove && selectedVariantKey === 'variant_b',
            },
          ],
        },
      },
      include: { variants: true },
    });

    // Auto-send for follow-ups
    if (autoApprove && deps?.boss) {
      const selectedVariant = draft.variants.find((v) => v.variantKey === selectedVariantKey);
      if (selectedVariant) {
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
          MESSAGE_SEND_RETRY_OPTIONS,
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

    throw error;
  }
}
