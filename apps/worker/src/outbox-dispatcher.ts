import type PgBoss from 'pg-boss';

import { buildFeaturesComputeSingletonKey } from '@lead-flood/contracts';
import { type Prisma, prisma } from '@lead-flood/db';

import {
  DISCOVERY_SEED_JOB_NAME,
  type DiscoverySeedJobPayload,
} from './jobs/discovery.seed.job.js';
import {
  FEATURES_COMPUTE_JOB_NAME,
  type FeaturesComputeJobPayload,
} from './jobs/features.compute.job.js';
import {
  MESSAGE_SEND_JOB_NAME,
  MESSAGE_SEND_RETRY_OPTIONS,
  type MessageSendJobPayload,
} from './jobs/message.send.job.js';
import {
  SCORING_COMPUTE_JOB_NAME,
  type ScoringComputeJobPayload,
} from './jobs/scoring.compute.job.js';

interface LegacyOutboxPayload {
  leadId: string;
  jobExecutionId: string;
  source: string;
}

type SupportedOutboxPayload =
  | LegacyOutboxPayload
  | DiscoverySeedOutboxPayload
  | FeaturesComputeJobPayload
  | MessageSendJobPayload
  | ScoringComputeJobPayload;
type ScoringComputeOutboxPayload = ScoringComputeJobPayload & { jobExecutionId?: string };
type DiscoverySeedOutboxPayload = DiscoverySeedJobPayload & {
  discoveryRunId: string;
  jobExecutionId: string;
  icpProfileId: string;
  countries: string[];
};
type MessageSendOutboxPayload = MessageSendJobPayload;

export interface OutboxDispatchPlan {
  jobExecutionId?: string;
  messageSendId?: string;
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

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

async function markTrackedJobRunning(
  jobExecutionId: string,
  type: typeof FEATURES_COMPUTE_JOB_NAME | typeof SCORING_COMPUTE_JOB_NAME,
  startedAt: Date,
): Promise<void> {
  await prisma.jobExecution.updateMany({
    where: {
      id: jobExecutionId,
      type,
      status: 'queued',
    },
    data: {
      status: 'running',
      startedAt,
      error: null,
    },
  });
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

function isMessageSendOutboxPayload(payload: unknown): payload is MessageSendOutboxPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.runId === 'string' &&
    typeof value.sendId === 'string' &&
    typeof value.messageDraftId === 'string' &&
    typeof value.messageVariantId === 'string' &&
    typeof value.idempotencyKey === 'string' &&
    (value.channel === 'EMAIL' || value.channel === 'WHATSAPP') &&
    (value.scheduledAt === undefined || isValidDateString(value.scheduledAt))
  );
}

function isScoringComputeOutboxPayload(payload: unknown): payload is ScoringComputeOutboxPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.runId === 'string' &&
    typeof value.mode === 'string' &&
    (value.jobExecutionId === undefined || typeof value.jobExecutionId === 'string') &&
    (value.correlationId === undefined || typeof value.correlationId === 'string') &&
    (value.icpProfileId === undefined || typeof value.icpProfileId === 'string') &&
    (value.modelVersionId === undefined || typeof value.modelVersionId === 'string') &&
    (value.requestedByUserId === undefined || typeof value.requestedByUserId === 'string') &&
    (
      value.leadIds === undefined ||
      (Array.isArray(value.leadIds) && value.leadIds.every((entry) => typeof entry === 'string'))
    )
  );
}

function isDiscoverySeedOutboxPayload(payload: unknown): payload is DiscoverySeedOutboxPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const value = payload as Record<string, unknown>;
  return (
    typeof value.discoveryRunId === 'string' &&
    typeof value.jobExecutionId === 'string' &&
    typeof value.icpProfileId === 'string' &&
    Array.isArray(value.countries) &&
    value.countries.every((entry) => typeof entry === 'string') &&
    (value.cities === undefined ||
      (Array.isArray(value.cities) && value.cities.every((entry) => typeof entry === 'string'))) &&
    (value.includeWebsiteAnalysis === undefined || typeof value.includeWebsiteAnalysis === 'boolean') &&
    (value.includeSocialMediaAnalysis === undefined || typeof value.includeSocialMediaAnalysis === 'boolean') &&
    (value.maxTasks === undefined || typeof value.maxTasks === 'number') &&
    (value.validationMode === undefined || typeof value.validationMode === 'boolean') &&
    (value.minReviewCount === undefined || typeof value.minReviewCount === 'number') &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.correlationId === undefined || typeof value.correlationId === 'string') &&
    (value.enqueueRunTasks === undefined || typeof value.enqueueRunTasks === 'boolean')
  );
}

export function resolveOutboxDispatchPlan(
  eventType: string,
  payload: unknown,
): OutboxDispatchPlan | null {
  if (eventType === MESSAGE_SEND_JOB_NAME) {
    if (!isMessageSendOutboxPayload(payload)) {
      return null;
    }

    return {
      messageSendId: payload.sendId,
      bossPayload: payload,
      singletonKey: `message.send:${payload.sendId}`,
    };
  }

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

  if (eventType === SCORING_COMPUTE_JOB_NAME) {
    if (!isScoringComputeOutboxPayload(payload)) {
      return null;
    }

    const bossPayload: ScoringComputeJobPayload = {
      runId: payload.runId,
      mode: payload.mode,
      ...(payload.correlationId !== undefined ? { correlationId: payload.correlationId } : {}),
      ...(payload.icpProfileId !== undefined ? { icpProfileId: payload.icpProfileId } : {}),
      ...(payload.leadIds !== undefined ? { leadIds: payload.leadIds } : {}),
      ...(payload.modelVersionId !== undefined ? { modelVersionId: payload.modelVersionId } : {}),
      ...(payload.requestedByUserId !== undefined ? { requestedByUserId: payload.requestedByUserId } : {}),
    };
    const singletonKey =
      payload.jobExecutionId && payload.icpProfileId && payload.leadIds?.length === 1
        ? `scoring.compute:${payload.runId}:${payload.leadIds[0]}:${payload.icpProfileId}`
        : `scoring.compute:${payload.runId}`;

    return {
      jobExecutionId: payload.jobExecutionId ?? payload.runId,
      bossPayload,
      singletonKey,
    };
  }

  if (eventType === DISCOVERY_SEED_JOB_NAME) {
    if (!isDiscoverySeedOutboxPayload(payload)) {
      return null;
    }

    return {
      jobExecutionId: payload.jobExecutionId,
      bossPayload: payload,
      singletonKey: `discovery.seed:${payload.discoveryRunId}:${payload.icpProfileId}`,
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

function resolveMessageSendStartAfter(payload: MessageSendOutboxPayload): Date | undefined {
  if (!payload.scheduledAt) {
    return undefined;
  }

  const scheduledAt = new Date(payload.scheduledAt);
  return scheduledAt.getTime() > Date.now() ? scheduledAt : undefined;
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

    if (dispatchPlan.messageSendId) {
      const targetMessageSend = await prisma.messageSend.findUnique({
        where: { id: dispatchPlan.messageSendId },
        select: { id: true, status: true },
      });

      if (!targetMessageSend) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'dead_letter',
            attempts: {
              increment: 1,
            },
            lastError: 'Referenced message send was not found',
            nextAttemptAt: null,
            processedAt: now,
          },
        });
        logger.warn(
          {
            outboxEventId: event.id,
            messageSendId: dispatchPlan.messageSendId,
          },
          'Promoted outbox event to dead letter queue because target message send is missing',
        );
        continue;
      }

      if (targetMessageSend.status !== 'QUEUED') {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'sent',
            attempts: {
              increment: 1,
            },
            lastError: `Skipped publish because MessageSend is already ${targetMessageSend.status}`,
            nextAttemptAt: null,
            processedAt: now,
          },
        });
        logger.info(
          {
            outboxEventId: event.id,
            messageSendId: targetMessageSend.id,
            messageSendStatus: targetMessageSend.status,
          },
          'Marked outbox event as sent without publish to avoid duplicate work',
        );
        continue;
      }
    } else {
      if (!dispatchPlan.jobExecutionId) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'dead_letter',
            attempts: {
              increment: 1,
            },
            lastError: 'Resolved outbox dispatch plan is missing a target job execution id',
            nextAttemptAt: null,
            processedAt: now,
          },
        });
        logger.warn(
          {
            outboxEventId: event.id,
            type: event.type,
          },
          'Promoted outbox event to dead letter queue because the dispatch plan was incomplete',
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
    }

    try {
      const messageSendStartAfter =
        event.type === MESSAGE_SEND_JOB_NAME
          ? resolveMessageSendStartAfter(dispatchPlan.bossPayload as MessageSendOutboxPayload)
          : undefined;
      const bossSendOptions =
        event.type === MESSAGE_SEND_JOB_NAME
          ? {
              singletonKey: dispatchPlan.singletonKey ?? `outbox:${event.id}`,
              ...MESSAGE_SEND_RETRY_OPTIONS,
              ...(messageSendStartAfter ? { startAfter: messageSendStartAfter } : {}),
            }
          : {
              singletonKey: dispatchPlan.singletonKey ?? `outbox:${event.id}`,
              retryLimit: 3,
              retryDelay: 5,
              retryBackoff: true,
            };

      await boss.send(event.type, dispatchPlan.bossPayload, {
        ...bossSendOptions,
      });

      const publishedAt = new Date();
      const trackedJobExecutionId = dispatchPlan.jobExecutionId;
      if (event.type === FEATURES_COMPUTE_JOB_NAME && trackedJobExecutionId) {
        await markTrackedJobRunning(trackedJobExecutionId, FEATURES_COMPUTE_JOB_NAME, publishedAt);
      } else if (
        event.type === SCORING_COMPUTE_JOB_NAME &&
        'runId' in dispatchPlan.bossPayload &&
        trackedJobExecutionId === dispatchPlan.bossPayload.runId
      ) {
        await markTrackedJobRunning(trackedJobExecutionId, SCORING_COMPUTE_JOB_NAME, publishedAt);
      }

      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'sent',
          attempts: {
            increment: 1,
          },
          processedAt: publishedAt,
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
