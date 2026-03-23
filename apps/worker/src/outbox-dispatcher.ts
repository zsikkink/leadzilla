import type PgBoss from 'pg-boss';

import { buildFeaturesComputeSingletonKey } from '@lead-flood/contracts';
import { type Prisma, prisma } from '@lead-flood/db';

import {
  FEATURES_COMPUTE_JOB_NAME,
  type FeaturesComputeJobPayload,
} from './jobs/features.compute.job.js';

interface LegacyOutboxPayload {
  leadId: string;
  jobExecutionId: string;
  source: string;
}

type SupportedOutboxPayload = LegacyOutboxPayload | FeaturesComputeJobPayload;

export interface OutboxDispatchPlan {
  jobExecutionId: string;
  bossPayload: SupportedOutboxPayload;
  singletonKey?: string;
}

const MAX_OUTBOX_ATTEMPTS = 5;
const DISPATCH_BATCH_SIZE = 20;
const STALE_PROCESSING_WINDOW_MS = 5 * 60 * 1000;
const BASE_RETRY_DELAY_MS = 5 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 1000;

const TERMINAL_OUTBOX_STATUSES = new Set(['sent', 'dead_letter']);

export interface OutboxDispatchLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

function isLegacyOutboxPayload(payload: unknown): payload is LegacyOutboxPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.leadId === 'string' &&
    typeof value.jobExecutionId === 'string' &&
    typeof value.source === 'string'
  );
}

function isFeaturesComputeOutboxPayload(payload: unknown): payload is FeaturesComputeJobPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.runId === 'string' &&
    typeof value.leadId === 'string' &&
    typeof value.icpProfileId === 'string' &&
    typeof value.snapshotVersion === 'number' &&
    Number.isInteger(value.snapshotVersion) &&
    value.snapshotVersion >= 1
  );
}

export function resolveOutboxDispatchPlan(
  eventType: string,
  payload: unknown,
): OutboxDispatchPlan | null {
  if (eventType === FEATURES_COMPUTE_JOB_NAME) {
    if (!isFeaturesComputeOutboxPayload(payload)) {
      return null;
    }

    return {
      jobExecutionId: payload.runId,
      bossPayload: payload,
      // Match the API's immediate publish key so retry publishes stay idempotent.
      singletonKey: buildFeaturesComputeSingletonKey({
        leadId: payload.leadId,
        icpProfileId: payload.icpProfileId,
        snapshotVersion: payload.snapshotVersion,
      }),
    };
  }

  if (isLegacyOutboxPayload(payload)) {
    return {
      jobExecutionId: payload.jobExecutionId,
      bossPayload: payload,
    };
  }

  return null;
}

function calculateRetryDelay(attempt: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

export async function dispatchPendingOutboxEvents(
  boss: Pick<PgBoss, 'send'>,
  logger: OutboxDispatchLogger,
): Promise<number> {
  const now = new Date();

  // Atomically claim a batch of outbox events using FOR UPDATE SKIP LOCKED
  // to prevent TOCTOU races between concurrent dispatchers
  const events = await prisma.$queryRaw<Array<{
    id: string;
    type: string;
    status: string;
    payload: Prisma.JsonValue;
    attempts: number;
    lastError: string | null;
    nextAttemptAt: Date | null;
    processedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>>`
    UPDATE "OutboxEvent"
    SET status = 'processing', "updatedAt" = NOW()
    WHERE id IN (
      SELECT id FROM "OutboxEvent"
      WHERE status = 'pending'
         OR (status = 'failed' AND "nextAttemptAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
         OR (
           status = 'processing'
           AND "updatedAt" <= ((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - (${STALE_PROCESSING_WINDOW_MS} * INTERVAL '1 millisecond'))
         )
      ORDER BY "createdAt" ASC
      LIMIT ${DISPATCH_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  let dispatchedCount = 0;

  for (const event of events) {

    if (TERMINAL_OUTBOX_STATUSES.has(event.status)) {
      continue;
    }

    if (event.attempts >= MAX_OUTBOX_ATTEMPTS) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'dead_letter',
          lastError: 'Max dispatch attempts exceeded',
          nextAttemptAt: null,
          processedAt: now,
        },
      });
      logger.warn(
        {
          outboxEventId: event.id,
          attempts: event.attempts,
        },
        'Promoted outbox event to dead letter queue due to max attempts',
      );
      continue;
    }

    const dispatchPlan = resolveOutboxDispatchPlan(event.type, event.payload);
    if (!dispatchPlan) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'dead_letter',
          attempts: {
            increment: 1,
          },
          lastError: 'Invalid outbox payload',
          nextAttemptAt: null,
          processedAt: now,
        },
      });
      logger.warn(
        {
          outboxEventId: event.id,
          payload: event.payload,
        },
        'Promoted outbox event to dead letter queue because payload is invalid',
      );
      continue;
    }

    const targetJob = await prisma.jobExecution.findUnique({
      where: { id: dispatchPlan.jobExecutionId },
      select: { id: true, status: true },
    });

    if (!targetJob) {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'dead_letter',
          attempts: {
            increment: 1,
          },
          lastError: 'Referenced job execution was not found',
          nextAttemptAt: null,
          processedAt: now,
        },
      });
      logger.warn(
        {
          outboxEventId: event.id,
          jobExecutionId: dispatchPlan.jobExecutionId,
        },
        'Promoted outbox event to dead letter queue because target job is missing',
      );
      continue;
    }

    if (targetJob.status !== 'queued') {
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'sent',
          attempts: {
            increment: 1,
          },
          lastError: `Skipped publish because target job is already ${targetJob.status}`,
          nextAttemptAt: null,
          processedAt: now,
        },
      });
      logger.info(
        {
          outboxEventId: event.id,
          jobExecutionId: targetJob.id,
          jobStatus: targetJob.status,
        },
        'Marked outbox event as sent without publish to avoid duplicate work',
      );
      continue;
    }

    try {
      await boss.send(event.type, dispatchPlan.bossPayload, {
        singletonKey: dispatchPlan.singletonKey ?? `outbox:${event.id}`,
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
      });

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'sent',
          attempts: {
            increment: 1,
          },
          processedAt: now,
          lastError: null,
          nextAttemptAt: null,
        },
      });

      dispatchedCount += 1;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown outbox dispatch failure';
      const attemptsAfterFailure = event.attempts + 1;

      if (attemptsAfterFailure >= MAX_OUTBOX_ATTEMPTS) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'dead_letter',
            attempts: {
              increment: 1,
            },
            lastError: errorMessage,
            nextAttemptAt: null,
            processedAt: now,
          },
        });

        logger.error(
          {
            outboxEventId: event.id,
            type: event.type,
            attempts: attemptsAfterFailure,
            error,
          },
          'Outbox dispatch failed and was promoted to dead letter queue',
        );
        continue;
      }

      const nextAttemptDelayMs = calculateRetryDelay(attemptsAfterFailure);

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'failed',
          attempts: {
            increment: 1,
          },
          lastError: errorMessage,
          nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs),
          processedAt: null,
        },
      });

      logger.error(
        {
          outboxEventId: event.id,
          type: event.type,
          attempts: attemptsAfterFailure,
          error,
        },
        'Outbox dispatch failed',
      );
    }
  }

  return dispatchedCount;
}
