import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

export const OUTBOX_CLEANUP_JOB_NAME = 'outbox.cleanup';

export const OUTBOX_CLEANUP_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'outbox.cleanup.dead_letter',
};

/** Delete completed/dead-lettered outbox events older than this many days. */
const RETENTION_DAYS = 30;

/** Batch size for deletion to avoid long transactions. */
const DELETE_BATCH_SIZE = 500;

export interface OutboxCleanupJobPayload {
  correlationId?: string | undefined;
}

export interface OutboxCleanupLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export async function handleOutboxCleanupJob(
  logger: OutboxCleanupLogger,
  job: Job<OutboxCleanupJobPayload>,
): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let totalDeleted = 0;

  logger.info(
    { jobId: job.id, cutoff: cutoff.toISOString(), retentionDays: RETENTION_DAYS },
    'Starting outbox cleanup',
  );

  try {
    let hasMore = true;
    while (hasMore) {
      const batch = await prisma.outboxEvent.findMany({
        where: {
          status: { in: ['sent', 'dead_letter'] },
          processedAt: { lt: cutoff },
        },
        select: { id: true },
        take: DELETE_BATCH_SIZE,
      });

      if (batch.length === 0) {
        hasMore = false;
        break;
      }

      const ids = batch.map((e) => e.id);
      const { count } = await prisma.outboxEvent.deleteMany({
        where: { id: { in: ids } },
      });

      totalDeleted += count;

      if (batch.length < DELETE_BATCH_SIZE) {
        hasMore = false;
      }
    }

    logger.info(
      { jobId: job.id, totalDeleted },
      'Outbox cleanup complete',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        totalDeleted,
        error: error instanceof Error ? error.message : String(error),
      },
      'Outbox cleanup failed — partial progress saved',
    );
    // Terminal job — never throw
  }
}
