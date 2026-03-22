import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';
import {
  getEnrichmentThreshold,
  isProviderWithinBudget,
} from '../utils/pipeline-settings.js';

// ── Constants ──────────────────────────────────────────────────────────
export const APOLLO_ENRICH_JOB_NAME = 'apollo.enrich';

export const APOLLO_ENRICH_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'apollo.enrich.dead_letter',
};

// ── Payload & Dependencies ─────────────────────────────────────────────
export interface ApolloEnrichJobPayload {
  leadId: string;
  icpProfileId: string;
  scorePredictionId: string;
  runId: string;
  scoreBand: 'LOW' | 'MEDIUM' | 'HIGH';
  apolloHasEmail: boolean;
  apolloHasDirectPhone: boolean;
  correlationId?: string | undefined;
}

export interface ApolloEnrichJobDependencies {
  apolloAdapter: {
    revealContactPhone?(params: { apolloId?: string | undefined; firstName?: string | undefined; lastName?: string | undefined; domain?: string | undefined }): Promise<
      | { status: 'success'; phone: string | null; asyncPending: boolean }
      | { status: 'retryable_error'; failure: { classification: 'retryable'; statusCode: number | null; message: string; raw: unknown } }
      | { status: 'terminal_error'; failure: { classification: 'terminal'; statusCode: number | null; message: string; raw: unknown } }
    >;
    isConfigured: boolean;
  };
  enqueueMessageGenerate?: ((payload: {
    leadId: string;
    icpProfileId: string;
    scorePredictionId: string;
    runId: string;
    correlationId?: string | undefined;
    channel: 'EMAIL' | 'WHATSAPP';
    autoApprove?: boolean | undefined;
  }) => Promise<void>) | undefined;
}

export interface ApolloEnrichLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

// ── Handler ─────────────────────────────────────────────────────────────
export async function handleApolloEnrichJob(
  logger: ApolloEnrichLogger,
  job: Job<ApolloEnrichJobPayload>,
  deps?: ApolloEnrichJobDependencies,
): Promise<void> {
  const {
    leadId,
    icpProfileId,
    scorePredictionId,
    runId,
    scoreBand,
    apolloHasEmail: _apolloHasEmail,
    apolloHasDirectPhone: _apolloHasDirectPhone,
    correlationId,
  } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;

  const logCtx = {
    jobId: job.id,
    queue: job.name,
    leadId,
    icpProfileId,
    scoreBand,
    correlationId: effectiveCorrelationId,
  };

  logger.info(logCtx, 'Started apollo.enrich job');

  // Load blended score for gating and finalization.
  const scorePrediction = await prisma.leadScorePrediction.findUnique({
    where: { id: scorePredictionId },
    select: { blendedScore: true },
  });
  const blendedScore = scorePrediction?.blendedScore ?? 0;

  // Load lead data up-front so we can continue pipeline to message.generate
  // even when paid Apollo reveal is skipped.
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      email: true,
      phone: true,
      decisionMakerPhone: true,
      businessId: true,
    },
  });

  if (!lead) {
    logger.warn(logCtx, 'Lead not found — skipping apollo.enrich');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  const hasEmail = Boolean(lead.email && lead.email.includes('@'));
  const hasPhone = Boolean(lead.decisionMakerPhone || lead.phone);

  const enqueueMessageGenerateIfSendable = async (
    emailAvailable: boolean,
    phoneAvailable: boolean,
    reason: string,
  ): Promise<void> => {
    if (!emailAvailable) return;
    if (!deps?.enqueueMessageGenerate) {
      logger.warn(
        { ...logCtx, reason },
        'Qualified lead has email but enqueueMessageGenerate dependency is missing',
      );
      return;
    }

    const channel: 'EMAIL' | 'WHATSAPP' = scoreBand === 'HIGH' && phoneAvailable ? 'WHATSAPP' : 'EMAIL';
    await deps.enqueueMessageGenerate({
      leadId,
      icpProfileId,
      scorePredictionId,
      runId,
      correlationId: effectiveCorrelationId,
      channel,
    });
    logger.info(
      { ...logCtx, reason, channel, emailAvailable, phoneAvailable },
      'Enqueued message.generate after apollo.enrich',
    );
  };

  // LOW → skip entirely, do not enqueue message.generate
  if (scoreBand === 'LOW') {
    logger.info(logCtx, 'LOW score band — skipping apollo.enrich entirely');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  // Enrichment threshold gate: skip paid Apollo reveal if score is too low
  const enrichmentThreshold = await getEnrichmentThreshold();
  if (blendedScore < enrichmentThreshold) {
    logger.info(
      { ...logCtx, blendedScore, enrichmentThreshold },
      'Score below enrichment threshold — skipping paid Apollo reveal',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_threshold');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  // Provider budget ceiling gate: skip if Apollo has exceeded daily budget
  const apolloWithinBudget = await isProviderWithinBudget('APOLLO');
  if (!apolloWithinBudget) {
    logger.warn(
      logCtx,
      'Apollo daily budget ceiling exceeded — skipping paid reveal',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_budget');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  // Get domain for Apollo search
  let domain: string | null = null;
  if (lead.businessId) {
    const business = await prisma.business.findUnique({
      where: { id: lead.businessId },
      select: { websiteDomain: true },
    });
    domain = business?.websiteDomain ?? null;
  }
  if (!domain && hasEmail) {
    domain = lead.email.split('@')[1] ?? null;
  }

  if (!domain) {
    logger.warn(logCtx, 'No domain available for Apollo reveal — skipping');
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_no_domain');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  if (!deps?.apolloAdapter.isConfigured) {
    logger.warn(logCtx, 'Apollo adapter not configured — skipping reveal');
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_not_configured');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  // Call Apollo phone reveal (1 mobile credit) — only for HIGH band
  if (scoreBand !== 'HIGH') {
    logger.info(
      { ...logCtx, scoreBand },
      'Score band is not HIGH — skipping phone reveal, continuing to message.generate',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_phone_reveal_not_high');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  if (hasPhone) {
    logger.info(logCtx, 'Lead already has phone — skipping phone reveal');
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_phone_reveal_has_phone');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  if (!deps?.apolloAdapter?.revealContactPhone) {
    logger.warn(logCtx, 'Apollo revealContactPhone not available — skipping');
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_phone_reveal_no_method');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  // Get primary contact info from business_contacts for the reveal call
  const primaryContact = await prisma.businessContact.findFirst({
    where: { businessId: lead.businessId! },
    orderBy: { positionRank: 'asc' },
    select: { name: true },
  });

  const revealParams: { firstName?: string | undefined; lastName?: string | undefined; domain?: string | undefined } = {};
  if (primaryContact?.name) {
    const nameParts = primaryContact.name.split(' ');
    const first = nameParts[0] ?? undefined;
    const last = nameParts.slice(1).join(' ') || undefined;
    if (first) revealParams.firstName = first;
    if (last) revealParams.lastName = last;
  }
  if (domain) {
    revealParams.domain = domain;
  }

  const phoneResult = await deps.apolloAdapter.revealContactPhone(revealParams);

  // Track cost: 1 mobile credit
  await prisma.discoveryCostEvent.create({
    data: {
      discoveryRunId: runId,
      provider: 'APOLLO',
      costCents: 5,
      apiCallType: 'phone_reveal',
      leadId,
    },
  });

  if (phoneResult.status === 'success' && phoneResult.phone) {
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        decisionMakerPhone: phoneResult.phone,
        ...(!lead.phone ? { phone: phoneResult.phone } : {}),
      },
    });
    logger.info(
      { ...logCtx, phone: phoneResult.phone },
      'Apollo phone reveal succeeded — updated lead',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, true, 'phone_revealed');
  } else if (phoneResult.status === 'success' && phoneResult.asyncPending) {
    logger.info(logCtx, 'Apollo phone reveal returned async pending — phone may arrive via webhook later');
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'phone_reveal_async');
  } else if (phoneResult.status !== 'success') {
    logger.warn(
      { ...logCtx, phoneStatus: phoneResult.status },
      'Apollo phone reveal failed — continuing without phone',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'phone_reveal_failed');
  } else {
    logger.info(logCtx, 'Apollo phone reveal returned no phone');
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'phone_reveal_empty');
  }

  await tryFinalizeDiscoveryRun(runId, logger);
  logger.info(logCtx, 'Completed apollo.enrich job');
}
