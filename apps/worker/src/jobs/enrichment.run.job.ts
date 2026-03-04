import type {
  CreateEnrichmentRunRequest,
  EnrichmentProvider,
} from '@lead-flood/contracts';
import { Prisma, prisma, toInputJson } from '@lead-flood/db';
import type { ProviderBudgetTracker } from '../utils/provider-budget.js';
import { getProviderCostCents } from '../utils/provider-budget.js';
import type { EnrichmentProviderRotator } from '../utils/provider-rotation.js';
import type {
  HunterAdapter,
  PdlEnrichmentAdapter,
  PublicWebLookupAdapter,
  NormalizedEnrichmentPayload,
  HunterEnrichmentRequest,
  PdlEnrichmentRequest,
  PublicWebLookupEnrichmentRequest,
} from '@lead-flood/providers';
import {
  consolidateCompanyProfile,
  isProfileSufficientForEnrichment,
  profileToEnrichmentPayload,
} from '@lead-flood/providers';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import {
  FEATURES_COMPUTE_JOB_NAME,
  FEATURES_COMPUTE_RETRY_OPTIONS,
  type FeaturesComputeJobPayload,
} from './features.compute.job.js';

export const ENRICHMENT_RUN_JOB_NAME = 'enrichment.run';
export const ENRICHMENT_RUN_IDEMPOTENCY_KEY_PATTERN = 'enrichment.run:${leadId}:${provider}';

export const ENRICHMENT_RUN_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 5,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'enrichment.run.dead_letter',
};

const ENRICHMENT_RECORD_JOB_TYPE = 'lead.enrichment';

export interface EnrichmentRunJobPayload
  extends Pick<CreateEnrichmentRunRequest, 'provider' | 'requestedByUserId'> {
  runId: string;
  leadId: string;
  discoveryRecordId?: string;
  icpProfileId?: string;
  correlationId?: string;
  jobExecutionId?: string;
}

export interface EnrichmentRunLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface EnrichmentRunDependencies {
  boss: Pick<PgBoss, 'send'>;
  pdlAdapter: PdlEnrichmentAdapter;
  hunterAdapter: HunterAdapter;
  publicWebLookupAdapter: PublicWebLookupAdapter;
  enrichmentEnabled: boolean;
  pdlEnabled: boolean;
  hunterEnabled: boolean;
  otherFreeEnabled: boolean;
  defaultProvider: EnrichmentProvider;
  providerRotator?: EnrichmentProviderRotator | undefined;
  budgetTracker?: ProviderBudgetTracker | undefined;
}

function domainFromEmail(email: string): string | undefined {
  const [, domain] = email.split('@');
  return domain?.toLowerCase();
}

function deriveProviderRecordId(
  result: UnifiedEnrichmentResult,
  fallbackEmail: string,
): string | null {
  if (result.status !== 'success') {
    return null;
  }

  const normalized = result.normalized;
  const fromPayload = normalized.email ?? normalized.domain;
  return fromPayload ?? fallbackEmail;
}

type UnifiedEnrichmentLead = NormalizedEnrichmentPayload;

interface UnifiedFailure {
  statusCode: number | null;
  message: string;
}

type UnifiedEnrichmentResult =
  | {
      status: 'success';
      normalized: UnifiedEnrichmentLead;
      raw: unknown;
    }
  | {
      status: 'retryable_error' | 'terminal_error';
      failure: UnifiedFailure;
    };

function toUnifiedFromPdl(result: Awaited<ReturnType<PdlEnrichmentAdapter['enrichLead']>>): UnifiedEnrichmentResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      normalized: result.normalized,
      raw: result.raw,
    };
  }

  return {
    status: result.status,
    failure: {
      statusCode: result.failure.statusCode,
      message: result.failure.message,
    },
  };
}

function toUnifiedFromHunter(
  result: Awaited<ReturnType<HunterAdapter['enrichLead']>>,
): UnifiedEnrichmentResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      normalized: result.normalized,
      raw: result.raw,
    };
  }

  return {
    status: result.status,
    failure: {
      statusCode: result.failure.statusCode,
      message: result.failure.message,
    },
  };
}

function toUnifiedFromPublicLookup(
  result: Awaited<ReturnType<PublicWebLookupAdapter['enrichLead']>>,
): UnifiedEnrichmentResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      normalized: result.normalized,
      raw: result.raw,
    };
  }

  return {
    status: result.status,
    failure: {
      statusCode: result.failure.statusCode,
      message: result.failure.message,
    },
  };
}

async function executeEnrichmentProvider(
  provider: EnrichmentProvider,
  leadEmail: string,
  correlationId: string,
  dependencies: EnrichmentRunDependencies,
): Promise<UnifiedEnrichmentResult> {
  const domain = domainFromEmail(leadEmail);
  const commonRequest: {
    email: string;
    correlationId: string;
    domain?: string;
  } = {
    email: leadEmail,
    correlationId,
  };
  if (domain) {
    commonRequest.domain = domain;
  }

  switch (provider) {
    case 'HUNTER': {
      if (!dependencies.hunterEnabled) {
        return {
          status: 'terminal_error',
          failure: {
            statusCode: null,
            message: 'HUNTER provider is disabled',
          },
        };
      }

      const request: HunterEnrichmentRequest = {
        email: commonRequest.email,
        correlationId: commonRequest.correlationId,
      };
      if (commonRequest.domain) {
        request.domain = commonRequest.domain;
      }

      return toUnifiedFromHunter(await dependencies.hunterAdapter.enrichLead(request));
    }

    case 'CLEARBIT': {
      return {
        status: 'terminal_error',
        failure: {
          statusCode: null,
          message: 'CLEARBIT provider has been deprecated and removed',
        },
      };
    }

    case 'OTHER_FREE': {
      if (!dependencies.otherFreeEnabled) {
        return {
          status: 'terminal_error',
          failure: {
            statusCode: null,
            message: 'OTHER_FREE provider is disabled',
          },
        };
      }

      const request: PublicWebLookupEnrichmentRequest = {
        email: commonRequest.email,
        correlationId: commonRequest.correlationId,
      };
      if (commonRequest.domain) {
        request.domain = commonRequest.domain;
      }

      return toUnifiedFromPublicLookup(await dependencies.publicWebLookupAdapter.enrichLead(request));
    }

    case 'PEOPLE_DATA_LABS':
    default: {
      if (!dependencies.pdlEnabled) {
        return {
          status: 'terminal_error',
          failure: {
            statusCode: null,
            message: 'PEOPLE_DATA_LABS provider is disabled',
          },
        };
      }

      const request: PdlEnrichmentRequest = {
        email: commonRequest.email,
        correlationId: commonRequest.correlationId,
      };
      if (commonRequest.domain) {
        request.domain = commonRequest.domain;
      }

      return toUnifiedFromPdl(await dependencies.pdlAdapter.enrichLead(request));
    }
  }
}

async function markEnrichmentJobRunning(jobExecutionId: string): Promise<void> {
  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: 'running',
      attempts: {
        increment: 1,
      },
      startedAt: new Date(),
      error: null,
    },
  });
}

async function markEnrichmentJobFailed(jobExecutionId: string, message: string): Promise<void> {
  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: 'failed',
      error: message,
      finishedAt: new Date(),
    },
  });
}

async function markEnrichmentJobCompleted(jobExecutionId: string, result: unknown): Promise<void> {
  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: 'completed',
      result: toInputJson(result),
      error: null,
      finishedAt: new Date(),
    },
  });
}

interface RotationResult {
  provider: EnrichmentProvider;
  result: UnifiedEnrichmentResult;
}

/**
 * Execute enrichment with provider rotation.
 *
 * When a `providerRotator` is configured in dependencies, terminal errors
 * or sparse data trigger automatic escalation to the next provider:
 *   OTHER_FREE → HUNTER → PEOPLE_DATA_LABS (cheapest first)
 *
 * Completeness check: if a provider returns data missing industry OR employee
 * count, we escalate to the next tier for richer data.
 *
 * Without a rotator, behavior is identical to the original single-provider call.
 */
async function executeWithRotation(
  initialProvider: EnrichmentProvider,
  leadEmail: string,
  correlationId: string,
  dependencies: EnrichmentRunDependencies,
  logger: EnrichmentRunLogger,
  jobId: string,
  runId: string,
  leadId: string,
  skipProviders?: string[] | undefined,
): Promise<RotationResult> {
  const rotator = dependencies.providerRotator;

  // Without a rotator, use the original single-provider path
  if (!rotator) {
    const result = await executeEnrichmentProvider(
      initialProvider,
      leadEmail,
      correlationId,
      dependencies,
    );
    return { provider: initialProvider, result };
  }

  // Pre-populate failed list with providers to skip (e.g. Hunter already called during conversion)
  const failedProviders: string[] = skipProviders ? [...skipProviders] : [];
  let currentProvider: EnrichmentProvider | null = initialProvider;

  while (currentProvider) {
    const result = await executeEnrichmentProvider(
      currentProvider,
      leadEmail,
      correlationId,
      dependencies,
    );

    if (result.status === 'success') {
      // Completeness check: if data is sparse (missing industry OR employee count),
      // escalate to next tier for richer data
      const normalized = result.normalized;
      const isSparse = !normalized.industry || normalized.employeeCount === null;
      if (isSparse && currentProvider !== 'PEOPLE_DATA_LABS') {
        logger.info(
          {
            jobId,
            runId,
            leadId,
            provider: currentProvider,
            missingIndustry: !normalized.industry,
            missingEmployeeCount: normalized.employeeCount === null,
          },
          `Provider ${currentProvider} returned sparse data — escalating to next tier`,
        );
        // Still record this as a success but try the next provider for more complete data
        // Only escalate forward (toward more expensive/richer providers)
        failedProviders.push(currentProvider);
        const currentIdx = rotator.getPriorityIndex(currentProvider);
        const nextProvider = rotator.getNextProviderAfter(currentIdx, failedProviders);
        if (nextProvider) {
          currentProvider = nextProvider;
          continue;
        }
        // No more providers — use what we have
      }
      rotator.recordSuccess(currentProvider);
      return { provider: currentProvider, result };
    }

    if (result.status === 'terminal_error') {
      rotator.recordFailure(currentProvider);
      failedProviders.push(currentProvider);

      logger.warn(
        {
          jobId,
          runId,
          leadId,
          provider: currentProvider,
          statusCode: result.failure.statusCode,
          failedProviders,
        },
        `Provider ${currentProvider} returned terminal_error, attempting rotation`,
      );

      currentProvider = rotator.getNextProvider(leadId, failedProviders);
      continue;
    }

    // retryable_error — let pg-boss handle retries for this provider
    rotator.recordFailure(currentProvider);
    return { provider: currentProvider, result };
  }

  // All providers exhausted
  return {
    provider: initialProvider,
    result: {
      status: 'terminal_error',
      failure: {
        statusCode: null,
        message: `All enrichment providers exhausted. Failed: ${failedProviders.join(', ')}`,
      },
    },
  };
}

export async function handleEnrichmentRunJob(
  logger: EnrichmentRunLogger,
  job: Job<EnrichmentRunJobPayload>,
  dependencies: EnrichmentRunDependencies,
): Promise<void> {
  const { runId, correlationId, leadId, provider, jobExecutionId, icpProfileId } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;
  const selectedProvider = provider ?? dependencies.defaultProvider;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: effectiveCorrelationId,
      leadId,
      provider: selectedProvider,
      jobExecutionId: jobExecutionId ?? null,
    },
    'Started enrichment.run job',
  );

  if (!dependencies.enrichmentEnabled) {
    logger.warn(
      {
        jobId: job.id,
        runId,
        correlationId: effectiveCorrelationId,
        leadId,
      },
      'Skipping enrichment.run job because enrichment is disabled',
    );
    return;
  }

  // ── B4: Hunter dedup flag — set during B10 profile consolidation below ──
  let hunterAlreadyRanInConversion = false;

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
      lead?.deletedAt ? 'Skipping soft-deleted lead' : 'Skipping enrichment.run job because lead was not found',
    );
    return;
  }

  if (jobExecutionId) {
    await markEnrichmentJobRunning(jobExecutionId);
  }

  // ── B10: Company profile consolidation — skip PDL if scraped data is sufficient ──
  // Load the source business (via BusinessConversion) and check if the consolidated
  // profile already has industry + employeeCount + companyName from scraping.
  const conversion = await prisma.businessConversion.findFirst({
    where: { leadId },
    select: { businessId: true, hunterContactJson: true },
  });

  if (conversion) {
    const sourceBusiness = await prisma.business.findUnique({
      where: { id: conversion.businessId },
      select: {
        name: true,
        websiteDomain: true,
        category: true,
        countryCode: true,
        city: true,
        phoneE164: true,
        rating: true,
        reviewCount: true,
        apifyWebsiteScrapeJson: true,
        apifyInstagramScrapeJson: true,
      },
    });

    if (sourceBusiness) {
      const profile = consolidateCompanyProfile(sourceBusiness);

      if (isProfileSufficientForEnrichment(profile)) {
        const scrapedPayload = profileToEnrichmentPayload(profile);
        logger.info(
          {
            jobId: job.id,
            runId,
            leadId,
            completenessScore: profile.completenessScore,
            industry: profile.industry,
            employeeCount: profile.employeeCount,
            companyName: profile.companyName,
          },
          'Consolidated profile is sufficient — skipping paid enrichment providers',
        );

        // Use scraped data as enrichment result directly
        const normalizedFromProfile: NormalizedEnrichmentPayload = {
          email: scrapedPayload.email ?? lead.email,
          phone: scrapedPayload.phone,
          domain: scrapedPayload.domain,
          companyName: scrapedPayload.companyName,
          industry: scrapedPayload.industry,
          employeeCount: scrapedPayload.employeeCount,
          country: scrapedPayload.country,
          city: scrapedPayload.city,
          linkedinUrl: scrapedPayload.linkedinUrl,
          website: scrapedPayload.website,
        };

        // Record enrichment as "SCRAPE_PROFILE" source
        const requestKey = `${runId}:${leadId}:SCRAPE_PROFILE:${job.id}`;
        const enrichmentRecord = await prisma.leadEnrichmentRecord.upsert({
          where: { requestKey },
          create: {
            leadId,
            provider: 'OTHER_FREE',
            status: 'COMPLETED',
            attempt: 1,
            providerRecordId: lead.email,
            normalizedPayload: toInputJson(normalizedFromProfile),
            rawPayload: toInputJson({ source: 'consolidated_profile', profile }),
            errorCode: null,
            errorMessage: null,
            enrichedAt: new Date(),
            requestKey,
          },
          update: {
            status: 'COMPLETED',
            providerRecordId: lead.email,
            normalizedPayload: toInputJson(normalizedFromProfile),
            rawPayload: toInputJson({ source: 'consolidated_profile', profile }),
            errorCode: null,
            errorMessage: null,
            enrichedAt: new Date(),
          },
        });

        const phoneFromProfile = normalizedFromProfile.phone ?? undefined;
        await prisma.lead.update({
          where: { id: leadId },
          data: {
            status: 'enriched',
            enrichmentData: toInputJson(normalizedFromProfile),
            error: null,
            ...(phoneFromProfile ? { phone: phoneFromProfile } : {}),
          },
        });

        if (jobExecutionId) {
          await markEnrichmentJobCompleted(jobExecutionId, normalizedFromProfile);
        }

        if (!icpProfileId) {
          logger.warn(
            { jobId: job.id, runId, leadId },
            'Missing icpProfileId — cannot proceed to features after profile enrichment',
          );
          await prisma.lead.update({
            where: { id: leadId },
            data: { status: 'failed', error: 'Missing icpProfileId in enrichment payload' },
          });
          return;
        }

        // Chain to features.compute
        const featuresPayload: FeaturesComputeJobPayload = {
          runId,
          leadId,
          icpProfileId,
          snapshotVersion: 1,
          sourceVersion: 'features_v1',
          enrichmentRecordId: enrichmentRecord.id,
          correlationId: effectiveCorrelationId,
        };

        await prisma.jobExecution.create({
          data: {
            type: FEATURES_COMPUTE_JOB_NAME,
            status: 'queued',
            payload: toInputJson(featuresPayload),
            leadId,
          },
        });

        await dependencies.boss.send(FEATURES_COMPUTE_JOB_NAME, featuresPayload, {
          singletonKey: `features.compute:${leadId}:${featuresPayload.snapshotVersion}`,
          ...FEATURES_COMPUTE_RETRY_OPTIONS,
        });

        logger.info(
          {
            jobId: job.id,
            runId,
            leadId,
            enrichmentRecordId: enrichmentRecord.id,
            source: 'consolidated_profile',
          },
          'Completed enrichment via consolidated profile — chained to features.compute',
        );
        return;
      }
    }
  }

  // Also use the conversion query result for the Hunter dedup check (avoid redundant query)
  if (!conversion) {
    // No conversion record — Hunter dedup not applicable
  } else if (conversion.hunterContactJson && conversion.hunterContactJson !== null) {
    hunterAlreadyRanInConversion = true;
    // (Already logged above if the earlier check ran)
  }

  try {
    // If Hunter already ran during conversion, adjust provider selection:
    // - If selectedProvider IS Hunter, start with OTHER_FREE instead
    // - If using rotation, pre-skip Hunter in the rotation
    const effectiveStartProvider = (hunterAlreadyRanInConversion && selectedProvider === 'HUNTER')
      ? 'OTHER_FREE' as EnrichmentProvider
      : selectedProvider;

    const enrichmentResult = await executeWithRotation(
      effectiveStartProvider,
      lead.email,
      effectiveCorrelationId,
      dependencies,
      logger,
      job.id,
      runId,
      leadId,
      hunterAlreadyRanInConversion ? ['HUNTER'] : undefined,
    );

    const effectiveProvider = enrichmentResult.provider;
    const result = enrichmentResult.result;

    // Record provider spend for budget tracking
    const providerCostCents = getProviderCostCents(effectiveProvider);
    if (dependencies.budgetTracker && providerCostCents > 0) {
      await dependencies.budgetTracker.recordSpend(effectiveProvider, providerCostCents, job.id);
      logger.info(
        {
          jobId: job.id,
          runId,
          provider: effectiveProvider,
          costCents: providerCostCents,
          dailySpend: dependencies.budgetTracker.getDailySpend(effectiveProvider),
          dailyBudget: dependencies.budgetTracker.getDailyBudget(),
        },
        'Recorded provider spend for enrichment call',
      );
    }

    // Accumulate provider cost on the Lead record for analytics
    if (providerCostCents > 0) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { costCents: { increment: providerCostCents } },
      });
    }

    const currentMaxAttempt = await prisma.leadEnrichmentRecord.aggregate({
      where: {
        leadId,
        provider: effectiveProvider,
      },
      _max: {
        attempt: true,
      },
    });
    const attempt = (currentMaxAttempt._max.attempt ?? 0) + 1;
    const requestKey = `${runId}:${leadId}:${effectiveProvider}:${job.id}`;

    const enrichmentRecord = await prisma.leadEnrichmentRecord.upsert({
      where: { requestKey },
      create: {
        leadId,
        provider: effectiveProvider,
        status: result.status === 'success' ? 'COMPLETED' : 'FAILED',
        attempt,
        providerRecordId: deriveProviderRecordId(result, lead.email),
        normalizedPayload:
          result.status === 'success'
            ? toInputJson(result.normalized)
            : Prisma.JsonNull,
        rawPayload: toInputJson(result),
        errorCode: result.status === 'success' ? null : 'ENRICHMENT_FAILED',
        errorMessage:
          result.status === 'success' ? null : result.failure.message,
        enrichedAt: result.status === 'success' ? new Date() : null,
        requestKey,
      },
      update: {
        status: result.status === 'success' ? 'COMPLETED' : 'FAILED',
        providerRecordId: deriveProviderRecordId(result, lead.email),
        normalizedPayload:
          result.status === 'success'
            ? toInputJson(result.normalized)
            : Prisma.JsonNull,
        rawPayload: toInputJson(result),
        errorCode: result.status === 'success' ? null : 'ENRICHMENT_FAILED',
        errorMessage:
          result.status === 'success' ? null : result.failure.message,
        enrichedAt: result.status === 'success' ? new Date() : null,
      },
    });

    // Keep JobExecution visibility for operators, but pipeline correctness uses LeadEnrichmentRecord.
    await prisma.jobExecution.create({
      data: {
        type: ENRICHMENT_RECORD_JOB_TYPE,
        status: result.status === 'success' ? 'completed' : 'failed',
        attempts: 1,
        payload: {
          runId,
          correlationId: effectiveCorrelationId,
          provider: effectiveProvider,
          leadId,
        },
        result: toInputJson(result),
        error:
          result.status === 'success'
            ? null
            : result.failure.message,
        leadId,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    if (result.status === 'success') {
      const phoneFromEnrichment = result.normalized.phone ?? undefined;
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          status: 'enriched',
          enrichmentData: toInputJson(result.normalized),
          error: null,
          ...(phoneFromEnrichment ? { phone: phoneFromEnrichment } : {}),
        },
      });

      if (jobExecutionId) {
        await markEnrichmentJobCompleted(jobExecutionId, result.normalized);
      }

      if (!icpProfileId) {
        logger.warn(
          {
            jobId: job.id,
            queue: job.name,
            runId,
            correlationId: effectiveCorrelationId,
            leadId,
          },
          'Missing icpProfileId in enrichment payload — cannot proceed to features',
        );
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: 'failed', error: 'Missing icpProfileId in enrichment payload' },
        });
        return;
      }

      const featuresPayload: FeaturesComputeJobPayload = {
        runId,
        leadId,
        icpProfileId,
        snapshotVersion: 1,
        sourceVersion: 'features_v1',
        enrichmentRecordId: enrichmentRecord.id,
        correlationId: effectiveCorrelationId,
      };

      const featuresJobExecution = await prisma.jobExecution.create({
        data: {
          type: FEATURES_COMPUTE_JOB_NAME,
          status: 'queued',
          payload: toInputJson(featuresPayload),
          leadId,
        },
      });

      await dependencies.boss.send(FEATURES_COMPUTE_JOB_NAME, featuresPayload, {
        singletonKey: `features.compute:${leadId}:${featuresPayload.snapshotVersion}`,
        ...FEATURES_COMPUTE_RETRY_OPTIONS,
      });

      logger.info(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          correlationId: effectiveCorrelationId,
          leadId,
          enrichmentRecordId: enrichmentRecord.id,
          featuresJobExecutionId: featuresJobExecution.id,
          provider: effectiveProvider,
        },
        'Completed enrichment.run job',
      );
      return;
    }

    await prisma.lead.update({
      where: { id: leadId },
      data: {
        status: result.status === 'terminal_error' ? 'failed' : 'processing',
        error: result.failure.message,
      },
    });

    if (jobExecutionId) {
      await markEnrichmentJobFailed(jobExecutionId, result.failure.message);
    }

    if (result.status === 'retryable_error') {
      const error = new Error(result.failure.message);
      logger.warn(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          correlationId: effectiveCorrelationId,
          provider: effectiveProvider,
          leadId,
          statusCode: result.failure.statusCode,
        },
        'Retryable enrichment failure detected',
      );
      throw error;
    }

    logger.warn(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        provider: effectiveProvider,
        leadId,
        statusCode: result.failure.statusCode,
      },
      'Terminal enrichment failure detected — all providers exhausted',
    );
  } catch (error: unknown) {
    if (jobExecutionId) {
      await markEnrichmentJobFailed(
        jobExecutionId,
        error instanceof Error ? error.message : 'Unknown enrichment failure',
      );
    }

    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        leadId,
        error,
      },
      'Failed enrichment.run job',
    );

    throw classifyError(error);
  }
}
