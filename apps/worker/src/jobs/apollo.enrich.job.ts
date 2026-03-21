import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { isPrismaUniqueConstraintError } from '../errors.js';
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
    runId: string;
    correlationId?: string | undefined;
    channel: 'EMAIL' | 'WHATSAPP';
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

  // Load lead data up-front so Apollo can enrich contact data while keeping
  // qualified leads in the manual draft-generation flow.
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      email: true,
      phone: true,
      decisionMakerPhone: true,
      businessId: true,
      deletedAt: true,
      status: true,
    },
  });

  if (!lead) {
    logger.warn(logCtx, 'Lead not found — skipping apollo.enrich');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  if (lead.deletedAt) {
    logger.warn(logCtx, 'Skipping soft-deleted lead in apollo.enrich');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  if (lead.status !== 'qualified') {
    logger.info(
      { ...logCtx, leadStatus: lead.status },
      'Lead is no longer eligible for Apollo enrichment, skipping apollo.enrich',
    );
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  const hasEmail = Boolean(lead.email && lead.email.includes('@'));
  const hasPhone = Boolean(lead.decisionMakerPhone || lead.phone);

  const logManualDraftReadinessIfSendable = (
    emailAvailable: boolean,
    phoneAvailable: boolean,
    reason: string,
  ): void => {
    if (!emailAvailable) return;

    const channel: 'EMAIL' | 'WHATSAPP' = scoreBand === 'HIGH' && phoneAvailable ? 'WHATSAPP' : 'EMAIL';
    logger.info(
      { ...logCtx, reason, channel, emailAvailable, phoneAvailable },
      'Qualified lead remains ready for manual draft generation after apollo.enrich',
    );
  };

  // LOW → skip entirely, do not advance to draft generation
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
    logManualDraftReadinessIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_threshold');
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
    logManualDraftReadinessIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_budget');
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

  // If nothing to reveal, keep the lead in the manual draft-generation flow.
  if (!needsEmailReveal && !needsPhoneReveal) {
    logger.info(
      { ...logCtx, hasEmail, hasPhone },
      'No Apollo reveal needed — keeping existing contact data',
    );
    logManualDraftReadinessIfSendable(hasEmail, hasPhone, 'no_reveal_needed');
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
    logManualDraftReadinessIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_no_domain');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  if (!deps?.apolloAdapter.isConfigured) {
    logger.warn(logCtx, 'Apollo adapter not configured — skipping reveal');
    logManualDraftReadinessIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_not_configured');
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  try {
    await prisma.apolloRevealAttempt.create({
      data: {
        leadId,
        icpProfileId,
        scorePredictionId,
        discoveryRunId: runId,
        jobId: job.id,
        status: 'CLAIMED',
      },
    });
  } catch (error: unknown) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const existingAttempt = await prisma.apolloRevealAttempt.findUnique({
      where: {
        leadId_icpProfileId_scorePredictionId: {
          leadId,
          icpProfileId,
          scorePredictionId,
        },
      },
      select: {
        id: true,
        status: true,
        jobId: true,
        claimedAt: true,
        completedAt: true,
      },
    });

    if (!existingAttempt) {
      throw error;
    }

    logger.info(
      {
        ...logCtx,
        attemptId: existingAttempt.id,
        attemptStatus: existingAttempt.status,
        existingJobId: existingAttempt.jobId,
        claimedAt: existingAttempt.claimedAt,
        completedAt: existingAttempt.completedAt,
      },
      'Apollo reveal attempt already claimed or completed — skipping duplicate provider call',
    );
    await tryFinalizeDiscoveryRun(runId, logger);
    return;
  }

  const markAttemptCompleted = async (): Promise<void> => {
    await prisma.apolloRevealAttempt.update({
      where: {
        leadId_icpProfileId_scorePredictionId: {
          leadId,
          icpProfileId,
          scorePredictionId,
        },
      },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  };

  // Call Apollo to reveal contact data (1 export credit)
  const apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);

  // Track Apollo cost event — ~$0.02/call based on Apollo pricing audit
  await prisma.discoveryCostEvent.create({
    data: {
      discoveryRunId: runId,
      provider: 'APOLLO',
      costCents: 2,
      apiCallType: 'post_score_enrich',
      leadId,
    },
  });

  if (apolloResult.status !== 'success' || apolloResult.contacts.length === 0) {
    await markAttemptCompleted();
    logger.warn(
      { ...logCtx, apolloStatus: apolloResult.status },
      'Apollo reveal returned no contacts — keeping qualified lead as-is',
    );
    logManualDraftReadinessIfSendable(hasEmail, hasPhone, 'skip_paid_reveal_empty');
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
    const updatedLead = await prisma.lead.updateMany({
      where: {
        id: leadId,
        deletedAt: null,
        status: 'qualified',
      },
      data: updateData,
    });

    if (updatedLead.count === 0) {
      await markAttemptCompleted();
      logger.info(
        { ...logCtx, revealedEmail, revealedPhone },
        'Skipped Apollo contact update to preserve downstream lifecycle state',
      );
      await tryFinalizeDiscoveryRun(runId, logger);
      return;
    }

    logger.info(
      { ...logCtx, revealedEmail, revealedPhone },
      'Updated lead with Apollo-revealed data',
    );
  }

  await markAttemptCompleted();
  const finalHasEmail = hasEmail || revealedEmail;
  const finalHasPhone = hasPhone || revealedPhone;
  if (!finalHasEmail) {
    logger.warn(logCtx, 'Lead still has no email after Apollo reveal — not ready for manual draft generation');
  } else {
    logManualDraftReadinessIfSendable(finalHasEmail, finalHasPhone, 'revealed_or_existing');
  }

  await tryFinalizeDiscoveryRun(runId, logger);
  logger.info(logCtx, 'Completed apollo.enrich job');
}
