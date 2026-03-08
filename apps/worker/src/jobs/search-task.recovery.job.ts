import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';

export const SEARCH_TASK_RECOVERY_JOB_NAME = 'search-task.recovery';

export const SEARCH_TASK_RECOVERY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'search-task.recovery.dead_letter',
};

/** Search tasks stuck in RUNNING for longer than this are considered stale. */
const RUNNING_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/** Search tasks stuck in PENDING for longer than this are considered abandoned. */
const PENDING_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Batch size to avoid long transactions. */
const RECOVERY_BATCH_SIZE = 200;

export interface SearchTaskRecoveryJobPayload {
  correlationId?: string | undefined;
}

export interface SearchTaskRecoveryLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export async function handleSearchTaskRecoveryJob(
  logger: SearchTaskRecoveryLogger,
  job: Job<SearchTaskRecoveryJobPayload>,
): Promise<void> {
  const runningCutoff = new Date(Date.now() - RUNNING_TIMEOUT_MS);
  const pendingCutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);
  let totalRecovered = 0;

  logger.info(
    {
      jobId: job.id,
      runningCutoff: runningCutoff.toISOString(),
      pendingCutoff: pendingCutoff.toISOString(),
    },
    'Starting search task recovery',
  );

  try {
    // Recover stuck RUNNING tasks (>10 min)
    const stuckRunning = await prisma.$executeRaw`
      UPDATE "search_tasks"
      SET "status" = 'FAILED',
          "error" = 'Auto-recovered: stuck in RUNNING for >10min',
          "updated_at" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "search_tasks"
        WHERE "status" = 'RUNNING'
          AND "updated_at" < ${runningCutoff}
        LIMIT ${RECOVERY_BATCH_SIZE}
      )
    `;

    if (stuckRunning > 0) {
      totalRecovered += stuckRunning;
      logger.info(
        { jobId: job.id, recovered: stuckRunning, type: 'RUNNING' },
        `Recovered ${stuckRunning} search tasks stuck in RUNNING`,
      );
    }

    // Recover abandoned PENDING tasks (>2 hours)
    const stuckPending = await prisma.$executeRaw`
      UPDATE "search_tasks"
      SET "status" = 'FAILED',
          "error" = 'Auto-recovered: stuck in PENDING for >2h',
          "updated_at" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "search_tasks"
        WHERE "status" = 'PENDING'
          AND "updated_at" < ${pendingCutoff}
        LIMIT ${RECOVERY_BATCH_SIZE}
      )
    `;

    if (stuckPending > 0) {
      totalRecovered += stuckPending;
      logger.info(
        { jobId: job.id, recovered: stuckPending, type: 'PENDING' },
        `Recovered ${stuckPending} search tasks stuck in PENDING`,
      );
    }

    logger.info(
      { jobId: job.id, totalRecovered },
      'Search task recovery complete',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        totalRecovered,
        error: formatErrorMessage(error),
      },
      'Search task recovery failed',
    );
    // Terminal job — never throw
  }
}
