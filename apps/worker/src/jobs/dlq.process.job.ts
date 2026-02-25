import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { WORKER_QUEUE_DEFINITIONS } from '../queues.js';

export const DLQ_JOB_NAME = 'dlq.process';

export const DLQ_PROCESS_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'dlq.process.dead_letter',
};

/** Maximum number of DLQ retries before flagging for manual review. */
const MAX_DLQ_RETRIES = 3;

/** Exponential backoff delays in seconds for each DLQ retry attempt. */
const DLQ_BACKOFF_SECONDS: Record<number, number> = {
  1: 3_600,      // 1 hour
  2: 14_400,     // 4 hours
  3: 86_400,     // 24 hours
};

/** Batch size for fetching jobs from each dead letter queue. */
const DLQ_FETCH_BATCH_SIZE = 100;

export interface DlqProcessJobPayload {
  correlationId?: string | undefined;
}

export interface DlqProcessLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

/**
 * Derives the original queue name from a dead letter queue name by stripping
 * the `.dead_letter` suffix.
 */
function getOriginalQueueName(dlqName: string): string {
  return dlqName.replace(/\.dead_letter$/, '');
}

/**
 * Collects all dead letter queue names from the worker queue definitions.
 */
function collectDeadLetterQueues(): string[] {
  const dlqNames: string[] = [];
  for (const definition of WORKER_QUEUE_DEFINITIONS) {
    if (definition.retryOptions.deadLetter) {
      dlqNames.push(definition.retryOptions.deadLetter);
    }
  }
  return dlqNames;
}

export interface DlqProcessJobDependencies {
  boss: Pick<PgBoss, 'fetch' | 'send' | 'complete' | 'getQueueSize'>;
}

export async function handleDlqProcessJob(
  logger: DlqProcessLogger,
  job: Job<DlqProcessJobPayload>,
  deps: DlqProcessJobDependencies,
): Promise<void> {
  const { boss } = deps;
  const dlqNames = collectDeadLetterQueues();

  logger.info(
    { jobId: job.id, dlqCount: dlqNames.length },
    'Starting DLQ processing sweep',
  );

  let totalRetried = 0;
  let totalFlagged = 0;

  for (const dlqName of dlqNames) {
    const originalQueue = getOriginalQueueName(dlqName);
    let retriedCount = 0;
    let flaggedCount = 0;

    // Fetch dead letter jobs in batches until the queue is drained
    let hasMore = true;
    while (hasMore) {
      const deadJobs = await boss.fetch<Record<string, unknown>>(dlqName, {
        batchSize: DLQ_FETCH_BATCH_SIZE,
      });

      if (deadJobs.length === 0) {
        hasMore = false;
        break;
      }

      for (const deadJob of deadJobs) {
        const data = deadJob.data ?? {};
        const currentRetryCount =
          typeof data.dlqRetryCount === 'number' ? data.dlqRetryCount : 0;

        if (currentRetryCount < MAX_DLQ_RETRIES) {
          const nextRetryCount = currentRetryCount + 1;
          const startAfterSeconds =
            DLQ_BACKOFF_SECONDS[nextRetryCount] ?? DLQ_BACKOFF_SECONDS[3]!;

          const retryData = {
            ...data,
            dlqRetryCount: nextRetryCount,
          };

          await boss.send(originalQueue, retryData, {
            startAfter: startAfterSeconds,
          });

          // Mark the DLQ job as completed so it's removed from the dead letter queue
          await boss.complete(dlqName, deadJob.id);

          retriedCount += 1;

          logger.info(
            {
              dlqQueue: dlqName,
              originalQueue,
              deadJobId: deadJob.id,
              dlqRetryCount: nextRetryCount,
              startAfterSeconds,
            },
            'Re-enqueued dead letter job with backoff',
          );
        } else {
          // Mark as completed to remove from the DLQ, but flag for manual review
          await boss.complete(dlqName, deadJob.id);

          flaggedCount += 1;

          logger.warn(
            {
              dlqQueue: dlqName,
              originalQueue,
              deadJobId: deadJob.id,
              dlqRetryCount: currentRetryCount,
              data,
            },
            'Dead letter job flagged for manual review — max DLQ retries exceeded',
          );
        }
      }

      // If we got fewer than the batch size, the queue is drained
      if (deadJobs.length < DLQ_FETCH_BATCH_SIZE) {
        hasMore = false;
      }
    }

    // Get remaining queue depth after processing
    const depth = await boss.getQueueSize(dlqName);

    if (retriedCount > 0 || flaggedCount > 0 || depth > 0) {
      logger.info(
        {
          queueName: dlqName,
          depth,
          retriedCount,
          flaggedCount,
        },
        'DLQ depth metrics',
      );
    }

    totalRetried += retriedCount;
    totalFlagged += flaggedCount;
  }

  logger.info(
    {
      jobId: job.id,
      totalRetried,
      totalFlagged,
      dlqQueuesProcessed: dlqNames.length,
    },
    'DLQ processing sweep complete',
  );
}
