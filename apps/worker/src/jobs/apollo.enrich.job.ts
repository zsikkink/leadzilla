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

export interface ApolloEnrichJobDependencies {
  apolloAdapter: {
    searchContactsByDomain(domain: string): Promise<ApolloContactSearchResult>;
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
    apolloHasEmail,
    apolloHasDirectPhone,
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

  // Determine what needs to be revealed
  let needsEmailReveal = false;
  let needsPhoneReveal = false;

  if (scoreBand === 'MEDIUM') {
    // MEDIUM → reveal email only if missing + Apollo has it. NEVER reveal phone.
    if (!hasEmail && apolloHasEmail) {
      needsEmailReveal = true;
    }
  } else if (scoreBand === 'HIGH') {
    // HIGH → reveal what's missing
    if (!hasEmail && apolloHasEmail) {
      needsEmailReveal = true;
    }
    if (hasEmail && !hasPhone && apolloHasDirectPhone) {
      needsPhoneReveal = true;
    }
    if (!hasEmail && apolloHasEmail) {
      // If revealing email, also reveal phone if available
      needsPhoneReveal = apolloHasDirectPhone;
    }
  }

  // If nothing to reveal, continue to message generation when sendable.
  if (!needsEmailReveal && !needsPhoneReveal) {
    logger.info(
      { ...logCtx, hasEmail, hasPhone },
      'No Apollo reveal needed — proceeding with existing contact data',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'no_reveal_needed');
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

  // Call Apollo to reveal contact data (1 export credit)
  const apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);

  // Track Apollo cost event (1 credit per API call regardless of result)
  await prisma.discoveryCostEvent.create({
    data: {
      discoveryRunId: runId,
      provider: 'APOLLO',
      costCents: 1,
      apiCallType: 'post_score_enrich',
      leadId,
    },
  });

  if (apolloResult.status !== 'success' || apolloResult.contacts.length === 0) {
    logger.warn(
      { ...logCtx, apolloStatus: apolloResult.status },
      'Apollo reveal returned no contacts — keeping qualified lead as-is',
    );
    await enqueueMessageGenerateIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_empty');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  const topContact = apolloResult.contacts[0]!;

  // Update lead with revealed data
  const updateData: Record<string, unknown> = {};
  let revealedEmail = false;
  let revealedPhone = false;

  if (needsEmailReveal && topContact.email) {
    updateData.email = topContact.email;
    revealedEmail = true;
  }

  if (needsPhoneReveal && topContact.phone) {
    updateData.decisionMakerPhone = topContact.phone;
    if (!lead.phone) {
      updateData.phone = topContact.phone;
    }
    revealedPhone = true;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
    });
    logger.info(
      { ...logCtx, revealedEmail, revealedPhone },
      'Updated lead with Apollo-revealed data',
    );
  }

  const finalHasEmail = hasEmail || revealedEmail;
  const finalHasPhone = hasPhone || revealedPhone;
  if (!finalHasEmail) {
    logger.warn(logCtx, 'Lead still has no email after Apollo reveal — cannot enqueue message.generate');
  } else {
    await enqueueMessageGenerateIfSendable(finalHasEmail, finalHasPhone, 'revealed_or_existing');
  }

  await tryFinalizeDiscoveryRun(runId, logger);
  logger.info(logCtx, 'Completed apollo.enrich job');
}
