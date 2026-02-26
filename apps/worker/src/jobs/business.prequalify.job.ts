import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

export const BUSINESS_PREQUALIFY_JOB_NAME = 'business.prequalify';

export const BUSINESS_PREQUALIFY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: 'business.prequalify.dead_letter',
};

/** Default minimum review count for pre-qualification. */
const DEFAULT_MIN_REVIEW_COUNT = 15;

export interface BusinessPrequalifyJobPayload {
  businessId: string;
  discoveryRunId: string;
  icpProfileId: string;
  minReviewCount?: number | undefined;
  includeWebsiteAnalysis?: boolean | undefined;
  includeSocialMediaAnalysis?: boolean | undefined;
  correlationId?: string | undefined;
}

export interface BusinessPrequalifyJobDependencies {
  enqueueBusinessConvert?: ((payload: {
    businessId: string;
    discoveryRunId: string;
    icpProfileId: string;
    includeWebsiteAnalysis?: boolean | undefined;
    includeSocialMediaAnalysis?: boolean | undefined;
    correlationId?: string | undefined;
  }) => Promise<void>) | undefined;
}

export interface BusinessPrequalifyLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export async function handleBusinessPrequalifyJob(
  logger: BusinessPrequalifyLogger,
  job: Job<BusinessPrequalifyJobPayload>,
  deps?: BusinessPrequalifyJobDependencies,
): Promise<void> {
  const {
    businessId,
    discoveryRunId,
    icpProfileId,
    minReviewCount,
    includeWebsiteAnalysis,
    includeSocialMediaAnalysis,
    correlationId,
  } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;
  const effectiveMinReviewCount = minReviewCount ?? DEFAULT_MIN_REVIEW_COUNT;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      businessId,
      discoveryRunId,
      icpProfileId,
      minReviewCount: effectiveMinReviewCount,
      correlationId: effectiveCorrelationId,
    },
    'Started business.prequalify job',
  );

  // ── Load business ──────────────────────────────────────────────────
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business) {
    logger.warn(
      {
        jobId: job.id,
        queue: job.name,
        businessId,
        discoveryRunId,
        correlationId: effectiveCorrelationId,
      },
      'Business not found — skipping pre-qualification',
    );
    return;
  }

  // ── Check: website domain ──────────────────────────────────────────
  if (!business.websiteDomain) {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        preQualified: false,
        disqualificationReason: 'NO_WEBSITE_DOMAIN',
      },
    });

    await recordCostEvent(discoveryRunId, businessId);

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        businessId,
        discoveryRunId,
        correlationId: effectiveCorrelationId,
        reason: 'NO_WEBSITE_DOMAIN',
      },
      'Business disqualified — no website domain',
    );
    return;
  }

  // ── Check: minimum review count ────────────────────────────────────
  const reviewCount = business.reviewCount ?? 0;
  if (reviewCount < effectiveMinReviewCount) {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        preQualified: false,
        disqualificationReason: 'INSUFFICIENT_REVIEWS',
      },
    });

    await recordCostEvent(discoveryRunId, businessId);

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        businessId,
        discoveryRunId,
        correlationId: effectiveCorrelationId,
        reason: 'INSUFFICIENT_REVIEWS',
        reviewCount,
        minReviewCount: effectiveMinReviewCount,
      },
      'Business disqualified — insufficient reviews',
    );
    return;
  }

  // ── Pre-qualification passed ───────────────────────────────────────
  await prisma.business.update({
    where: { id: businessId },
    data: {
      preQualified: true,
      disqualificationReason: null,
    },
  });

  await recordCostEvent(discoveryRunId, businessId);

  // ── Enqueue business.convert if dependency provided ────────────────
  if (deps?.enqueueBusinessConvert) {
    await deps.enqueueBusinessConvert({
      businessId,
      discoveryRunId,
      icpProfileId,
      includeWebsiteAnalysis,
      includeSocialMediaAnalysis,
      correlationId: effectiveCorrelationId,
    });

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        businessId,
        discoveryRunId,
        icpProfileId,
        correlationId: effectiveCorrelationId,
      },
      'Enqueued business.convert for pre-qualified business',
    );
  }

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      businessId,
      discoveryRunId,
      icpProfileId,
      correlationId: effectiveCorrelationId,
      reviewCount,
    },
    'Completed business.prequalify job — business qualified',
  );
}

/**
 * Record a zero-cost DiscoveryCostEvent for the pre-qualification check.
 */
async function recordCostEvent(
  discoveryRunId: string,
  businessId: string,
): Promise<void> {
  await prisma.discoveryCostEvent.create({
    data: {
      discoveryRunId,
      provider: 'SERPAPI',
      costCents: 0,
      apiCallType: 'prequalify_check',
      businessId,
    },
  });
}
