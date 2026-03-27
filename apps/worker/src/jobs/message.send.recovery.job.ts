import { prisma } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import {
  MESSAGE_SEND_JOB_NAME,
  MESSAGE_SEND_RETRY_OPTIONS,
  type MessageSendJobPayload,
} from './message.send.job.js';

export const MESSAGE_SEND_RECOVERY_JOB_NAME = 'message.send.recovery';

export const MESSAGE_SEND_RECOVERY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'message.send.recovery.dead_letter',
};

export const STALE_QUEUED_MESSAGE_SEND_THRESHOLD_MS = 10 * 60 * 1000;
const STALE_QUEUED_MESSAGE_SEND_BATCH_SIZE = 100;

export interface MessageSendRecoveryJobPayload {
  correlationId?: string | undefined;
}

export interface MessageSendRecoveryLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface MessageSendRecoveryJobDependencies {
  boss: Pick<PgBoss, 'send'>;
}

interface RecoverableQueuedMessageSend {
  id: string;
  messageDraftId: string;
  messageVariantId: string;
  idempotencyKey: string;
  channel: 'EMAIL' | 'WHATSAPP';
  scheduledAt: Date | null;
}

interface RecoverableSendingMessageSend {
  id: string;
  updatedAt: Date;
}

function buildRecoveredMessageSendPayload(
  send: RecoverableQueuedMessageSend,
): MessageSendJobPayload {
  return {
    runId: `message.send:${send.id}`,
    sendId: send.id,
    messageDraftId: send.messageDraftId,
    messageVariantId: send.messageVariantId,
    idempotencyKey: send.idempotencyKey,
    channel: send.channel,
    ...(send.scheduledAt ? { scheduledAt: send.scheduledAt.toISOString() } : {}),
  };
}

export async function recoverStaleQueuedMessageSends(
  logger: MessageSendRecoveryLogger,
  deps: MessageSendRecoveryJobDependencies,
  now: Date = new Date(),
): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_QUEUED_MESSAGE_SEND_THRESHOLD_MS);

  const staleQueuedSends = await prisma.messageSend.findMany({
    where: {
      status: 'QUEUED',
      updatedAt: { lt: staleBefore },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: STALE_QUEUED_MESSAGE_SEND_BATCH_SIZE,
    select: {
      id: true,
      messageDraftId: true,
      messageVariantId: true,
      idempotencyKey: true,
      channel: true,
      scheduledAt: true,
    },
  });

  for (const send of staleQueuedSends) {
    const recoveredPayload = buildRecoveredMessageSendPayload(send);
    const startAfter =
      send.scheduledAt && send.scheduledAt.getTime() > now.getTime()
        ? send.scheduledAt
        : undefined;

    await deps.boss.send(MESSAGE_SEND_JOB_NAME, recoveredPayload, {
      singletonKey: `message.send:${send.id}`,
      ...MESSAGE_SEND_RETRY_OPTIONS,
      ...(startAfter ? { startAfter } : {}),
    });

    logger.info(
      {
        sendId: send.id,
        scheduledAt: send.scheduledAt?.toISOString() ?? null,
        queuedUntil: staleBefore.toISOString(),
        dispatchMode: startAfter ? 'scheduled' : 'immediate',
      },
      'Re-enqueued stale queued MessageSend',
    );
  }

  logger.info(
    {
      staleBefore: staleBefore.toISOString(),
      recoveredCount: staleQueuedSends.length,
    },
    'Completed stale queued MessageSend recovery',
  );

  return staleQueuedSends.length;
}

async function quarantineStaleSendingMessageSends(
  logger: MessageSendRecoveryLogger,
  now: Date = new Date(),
): Promise<number> {
  const staleBefore = new Date(now.getTime() - STALE_QUEUED_MESSAGE_SEND_THRESHOLD_MS);

  const staleSendingSends = await prisma.messageSend.findMany({
    where: {
      status: 'SENDING',
      updatedAt: { lt: staleBefore },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: STALE_QUEUED_MESSAGE_SEND_BATCH_SIZE,
    select: {
      id: true,
      updatedAt: true,
    },
  });

  let quarantinedCount = 0;

  for (const send of staleSendingSends as RecoverableSendingMessageSend[]) {
    const updateResult = await prisma.messageSend.updateMany({
      where: {
        id: send.id,
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
      },
    });

    if (updateResult.count > 0) {
      quarantinedCount += 1;
      logger.warn(
        {
          sendId: send.id,
          sendingSince: send.updatedAt.toISOString(),
          staleBefore: staleBefore.toISOString(),
        },
        'Quarantined stale sending MessageSend',
      );
      continue;
    }

    logger.info(
      {
        sendId: send.id,
        sendingSince: send.updatedAt.toISOString(),
        staleBefore: staleBefore.toISOString(),
      },
      'Skipped stale sending MessageSend quarantine because status advanced',
    );
  }

  logger.info(
    {
      staleBefore: staleBefore.toISOString(),
      quarantinedCount,
    },
    'Completed stale sending MessageSend quarantine',
  );

  return quarantinedCount;
}

export async function runMessageSendRecovery(
  logger: MessageSendRecoveryLogger,
  deps: MessageSendRecoveryJobDependencies,
): Promise<{ recoveredCount: number; quarantinedCount: number }> {
  const recoveredCount = await recoverStaleQueuedMessageSends(logger, deps);
  const quarantinedCount = await quarantineStaleSendingMessageSends(logger);

  return {
    recoveredCount,
    quarantinedCount,
  };
}

export async function handleMessageSendRecoveryJob(
  logger: MessageSendRecoveryLogger,
  job: Job<MessageSendRecoveryJobPayload>,
  deps: MessageSendRecoveryJobDependencies,
): Promise<void> {
  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      correlationId: job.data.correlationId ?? job.id,
    },
    'Started message.send recovery job',
  );

  try {
    const { recoveredCount, quarantinedCount } = await runMessageSendRecovery(logger, deps);

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        correlationId: job.data.correlationId ?? job.id,
        recoveredCount,
        quarantinedCount,
      },
      'Completed message.send recovery job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        correlationId: job.data.correlationId ?? job.id,
        error,
      },
      'Failed message.send recovery job',
    );
    throw error;
  }
}
