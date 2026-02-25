import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

export const PIPELINE_HEALTH_JOB_NAME = 'pipeline.health';

export const PIPELINE_HEALTH_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'pipeline.health.dead_letter',
};

export interface PipelineHealthJobPayload {
  checkTypes?: string[] | undefined;
  correlationId?: string | undefined;
}

export interface PipelineHealthLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

interface DlqDepthRow {
  name: string;
  count: bigint;
}

interface StaleJobRow {
  name: string;
  count: bigint;
}

const DLQ_DEPTH_THRESHOLD = 10;
const STALE_JOB_MINUTES = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

export async function handlePipelineHealthJob(
  logger: PipelineHealthLogger,
  job: Job<PipelineHealthJobPayload>,
): Promise<void> {
  const { correlationId } = job.data;

  logger.info(
    { jobId: job.id, queue: job.name, correlationId: correlationId ?? job.id },
    'Started pipeline.health job',
  );

  try {
    await checkDlqDepth(logger, job);
    await checkStaleJobs(logger, job);
    await checkLeadThroughput(logger, job);
    await checkMessageSendSuccessRate(logger, job);
    await checkEnrichmentCompletionRate(logger, job);

    logger.info(
      { jobId: job.id, queue: job.name, correlationId: correlationId ?? job.id },
      'Completed pipeline.health job',
    );
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, queue: job.name, correlationId: correlationId ?? job.id, error },
      'Failed pipeline.health job',
    );
    // Don't rethrow — health checks should not block the pipeline
  }
}

async function checkDlqDepth(
  logger: PipelineHealthLogger,
  job: Job<PipelineHealthJobPayload>,
): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<DlqDepthRow[]>(
      `SELECT name, count(*) FROM pgboss.job WHERE name LIKE '%.dead_letter' AND state = 'created' GROUP BY name`,
    );

    let hasWarning = false;
    for (const row of rows) {
      const count = Number(row.count);
      if (count > DLQ_DEPTH_THRESHOLD) {
        hasWarning = true;
        logger.warn(
          { jobId: job.id, check: 'dlq_depth', queue: row.name, count },
          `Dead letter queue "${row.name}" has ${count} jobs (threshold: ${DLQ_DEPTH_THRESHOLD})`,
        );
      }
    }

    if (!hasWarning) {
      logger.info(
        { jobId: job.id, check: 'dlq_depth', queues: rows.map((r) => ({ name: r.name, count: Number(r.count) })) },
        'All dead letter queues within threshold',
      );
    }
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, check: 'dlq_depth', error },
      'Failed to check DLQ depth — pgboss schema may not exist',
    );
  }
}

async function checkStaleJobs(
  logger: PipelineHealthLogger,
  job: Job<PipelineHealthJobPayload>,
): Promise<void> {
  try {
    const rows = await prisma.$queryRawUnsafe<StaleJobRow[]>(
      `SELECT name, count(*) FROM pgboss.job WHERE state = 'active' AND startedon < NOW() - INTERVAL '${STALE_JOB_MINUTES} minutes' GROUP BY name`,
    );

    let hasWarning = false;
    for (const row of rows) {
      const count = Number(row.count);
      hasWarning = true;
      logger.warn(
        { jobId: job.id, check: 'stale_jobs', queue: row.name, count, thresholdMinutes: STALE_JOB_MINUTES },
        `Queue "${row.name}" has ${count} jobs stuck in active state for >${STALE_JOB_MINUTES}min`,
      );
    }

    if (!hasWarning) {
      logger.info(
        { jobId: job.id, check: 'stale_jobs' },
        'No stale active jobs detected',
      );
    }
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, check: 'stale_jobs', error },
      'Failed to check stale jobs — pgboss schema may not exist',
    );
  }
}

async function checkLeadThroughput(
  logger: PipelineHealthLogger,
  job: Job<PipelineHealthJobPayload>,
): Promise<void> {
  try {
    const now = Date.now();
    const last24h = await prisma.lead.count({
      where: { createdAt: { gte: new Date(now - ONE_DAY_MS) } },
    });

    const lastWeek = await prisma.lead.count({
      where: { createdAt: { gte: new Date(now - ONE_WEEK_MS) } },
    });

    const weeklyDailyAverage = lastWeek / 7;
    const ratio = weeklyDailyAverage > 0 ? last24h / weeklyDailyAverage : 0;

    // Warn if today's count is less than 20% of weekly average (significant drop)
    if (weeklyDailyAverage > 0 && ratio < 0.2) {
      logger.warn(
        {
          jobId: job.id,
          check: 'lead_throughput',
          last24h,
          weeklyDailyAverage: Number(weeklyDailyAverage.toFixed(2)),
          ratio: Number(ratio.toFixed(4)),
        },
        `Lead throughput dropped: ${last24h} in last 24h vs ${weeklyDailyAverage.toFixed(1)} daily average`,
      );
    } else {
      logger.info(
        {
          jobId: job.id,
          check: 'lead_throughput',
          last24h,
          weeklyDailyAverage: Number(weeklyDailyAverage.toFixed(2)),
          ratio: Number(ratio.toFixed(4)),
        },
        'Lead pipeline throughput within normal range',
      );
    }
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, check: 'lead_throughput', error },
      'Failed to check lead throughput',
    );
  }
}

async function checkMessageSendSuccessRate(
  logger: PipelineHealthLogger,
  job: Job<PipelineHealthJobPayload>,
): Promise<void> {
  try {
    const since = new Date(Date.now() - ONE_DAY_MS);

    const sentCount = await prisma.messageSend.count({
      where: { status: 'SENT', createdAt: { gte: since } },
    });

    const deliveredCount = await prisma.messageSend.count({
      where: { status: 'DELIVERED', createdAt: { gte: since } },
    });

    const failedCount = await prisma.messageSend.count({
      where: { status: 'FAILED', createdAt: { gte: since } },
    });

    const totalAttempted = sentCount + deliveredCount + failedCount;
    const successCount = sentCount + deliveredCount;
    const successRate = totalAttempted > 0 ? successCount / totalAttempted : 1;

    // Warn if success rate drops below 80% with a meaningful sample
    if (totalAttempted >= 5 && successRate < 0.8) {
      logger.warn(
        {
          jobId: job.id,
          check: 'message_send_rate',
          sentCount,
          deliveredCount,
          failedCount,
          totalAttempted,
          successRate: Number(successRate.toFixed(4)),
        },
        `Message send success rate is ${(successRate * 100).toFixed(1)}% (${failedCount} failed out of ${totalAttempted})`,
      );
    } else {
      logger.info(
        {
          jobId: job.id,
          check: 'message_send_rate',
          sentCount,
          deliveredCount,
          failedCount,
          totalAttempted,
          successRate: Number(successRate.toFixed(4)),
        },
        'Message send success rate within acceptable range',
      );
    }
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, check: 'message_send_rate', error },
      'Failed to check message send success rate',
    );
  }
}

async function checkEnrichmentCompletionRate(
  logger: PipelineHealthLogger,
  job: Job<PipelineHealthJobPayload>,
): Promise<void> {
  try {
    // Count leads that have at least one score prediction (scored leads)
    const scoredLeadCount = await prisma.leadScorePrediction.groupBy({
      by: ['leadId'],
      _count: true,
    });
    const totalScoredLeads = scoredLeadCount.length;

    // Count leads that have at least one completed enrichment record
    const enrichedLeadCount = await prisma.leadEnrichmentRecord.groupBy({
      by: ['leadId'],
      where: { status: 'COMPLETED' },
      _count: true,
    });
    const totalEnrichedLeads = enrichedLeadCount.length;

    const completionRate = totalScoredLeads > 0 ? totalEnrichedLeads / totalScoredLeads : 1;

    // Warn if fewer than 70% of scored leads have enrichment data
    if (totalScoredLeads >= 10 && completionRate < 0.7) {
      logger.warn(
        {
          jobId: job.id,
          check: 'enrichment_completion',
          totalScoredLeads,
          totalEnrichedLeads,
          completionRate: Number(completionRate.toFixed(4)),
        },
        `Enrichment completion rate is ${(completionRate * 100).toFixed(1)}% (${totalEnrichedLeads} enriched of ${totalScoredLeads} scored)`,
      );
    } else {
      logger.info(
        {
          jobId: job.id,
          check: 'enrichment_completion',
          totalScoredLeads,
          totalEnrichedLeads,
          completionRate: Number(completionRate.toFixed(4)),
        },
        'Enrichment completion rate within acceptable range',
      );
    }
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, check: 'enrichment_completion', error },
      'Failed to check enrichment completion rate',
    );
  }
}
