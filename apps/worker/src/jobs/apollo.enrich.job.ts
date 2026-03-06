import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { tryFinalizeDiscoveryRun } from '../utils/discovery-run-tracker.js';
import {
  getEnrichmentThreshold,
  isProviderWithinBudget,
  loadAutoApproveConfig,
  shouldAutoApprove,
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
    autoApprove: boolean;
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

  // Load auto-approve config once for this job
  const autoApproveConfig = await loadAutoApproveConfig();

  // Load blended score for auto-approve decision
  const scorePrediction = await prisma.leadScorePrediction.findUnique({
    where: { id: scorePredictionId },
    select: { blendedScore: true },
  });
  const blendedScore = scorePrediction?.blendedScore ?? 0;
  const autoApprove = shouldAutoApprove(autoApproveConfig, blendedScore);

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
    // Still proceed to message.generate with existing data if email exists
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { email: true, phone: true, decisionMakerPhone: true },
    });
    const hasEmail = Boolean(lead?.email && lead.email.includes('@'));
    const hasPhone = Boolean(lead?.decisionMakerPhone || lead?.phone);
    if (deps?.enqueueMessageGenerate && hasEmail) {
      const channel = scoreBand === 'HIGH' && hasPhone ? 'WHATSAPP' : 'EMAIL';
      await deps.enqueueMessageGenerate({
        leadId,
        icpProfileId,
        scorePredictionId,
        runId,
        correlationId: effectiveCorrelationId,
        channel,
        autoApprove,
      });
    } else {
      await tryFinalizeDiscoveryRun(runId, logger);
    }
    return;
  }

  // Provider budget ceiling gate: skip if Apollo has exceeded daily budget
  const apolloWithinBudget = await isProviderWithinBudget('APOLLO');
  if (!apolloWithinBudget) {
    logger.warn(
      logCtx,
      'Apollo daily budget ceiling exceeded — skipping paid reveal',
    );
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { email: true, phone: true, decisionMakerPhone: true },
    });
    const hasEmail = Boolean(lead?.email && lead.email.includes('@'));
    const hasPhone = Boolean(lead?.decisionMakerPhone || lead?.phone);
    if (deps?.enqueueMessageGenerate && hasEmail) {
      const channel = scoreBand === 'HIGH' && hasPhone ? 'WHATSAPP' : 'EMAIL';
      await deps.enqueueMessageGenerate({
        leadId,
        icpProfileId,
        scorePredictionId,
        runId,
        correlationId: effectiveCorrelationId,
        channel,
        autoApprove,
      });
    } else {
      await tryFinalizeDiscoveryRun(runId, logger);
    }
    return;
  }

  // Load lead data
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

  // If nothing to reveal, proceed to message.generate with current data
  if (!needsEmailReveal && !needsPhoneReveal) {
    logger.info(
      { ...logCtx, hasEmail, hasPhone },
      'No Apollo reveal needed — proceeding to message.generate',
    );

    if (deps?.enqueueMessageGenerate) {
      const channel = scoreBand === 'HIGH' && hasPhone ? 'WHATSAPP' : 'EMAIL';
      await deps.enqueueMessageGenerate({
        leadId,
        icpProfileId,
        scorePredictionId,
        runId,
        correlationId: effectiveCorrelationId,
        channel,
        autoApprove,
      });
    }
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
    if (deps?.enqueueMessageGenerate && hasEmail) {
      await deps.enqueueMessageGenerate({
        leadId,
        icpProfileId,
        scorePredictionId,
        runId,
        correlationId: effectiveCorrelationId,
        channel: 'EMAIL',
        autoApprove,
      });
    } else {
      await tryFinalizeDiscoveryRun(runId, logger);
    }
    return;
  }

  if (!deps?.apolloAdapter.isConfigured) {
    logger.warn(logCtx, 'Apollo adapter not configured — skipping reveal');
    if (deps?.enqueueMessageGenerate && hasEmail) {
      await deps.enqueueMessageGenerate({
        leadId,
        icpProfileId,
        scorePredictionId,
        runId,
        correlationId: effectiveCorrelationId,
        channel: 'EMAIL',
        autoApprove,
      });
    } else {
      await tryFinalizeDiscoveryRun(runId, logger);
    }
    return;
  }

  // Call Apollo to reveal contact data (1 export credit)
  const apolloResult = await deps.apolloAdapter.searchContactsByDomain(domain);

  if (apolloResult.status !== 'success' || apolloResult.contacts.length === 0) {
    logger.warn(
      { ...logCtx, apolloStatus: apolloResult.status },
      'Apollo reveal returned no contacts — proceeding with existing data',
    );
    if (deps?.enqueueMessageGenerate && hasEmail) {
      await deps.enqueueMessageGenerate({
        leadId,
        icpProfileId,
        scorePredictionId,
        runId,
        correlationId: effectiveCorrelationId,
        channel: 'EMAIL',
        autoApprove,
      });
    } else {
      await tryFinalizeDiscoveryRun(runId, logger);
    }
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

  // Determine channel: HIGH + phone → WHATSAPP, else → EMAIL
  const finalHasPhone = hasPhone || revealedPhone;
  const finalHasEmail = hasEmail || revealedEmail;
  const channel = scoreBand === 'HIGH' && finalHasPhone ? 'WHATSAPP' : 'EMAIL';

  if (deps?.enqueueMessageGenerate && finalHasEmail) {
    await deps.enqueueMessageGenerate({
      leadId,
      icpProfileId,
      scorePredictionId,
      runId,
      correlationId: effectiveCorrelationId,
      channel,
      autoApprove,
    });
    logger.info(
      { ...logCtx, channel, revealedEmail, revealedPhone },
      'Enqueued message.generate after Apollo reveal',
    );
  } else if (!finalHasEmail) {
    logger.warn(logCtx, 'Lead still has no email after Apollo reveal — cannot enqueue message.generate');
    // Terminal: lead can't get a message without email
    await tryFinalizeDiscoveryRun(runId, logger);
  }

  logger.info(logCtx, 'Completed apollo.enrich job');
}
