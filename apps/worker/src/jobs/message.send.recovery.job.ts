import { prisma } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

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

interface RecoverableSendingMessageSend {
  id: string;
  updatedAt: Date;
}

export async function recoverStaleQueuedMessageSends(
  logger: MessageSendRecoveryLogger,
  deps: MessageSendRecoveryJobDependencies,
  now: Date = new Date(),
): Promise<number> {
  void deps;
  void now;
  logger.warn(
    {},
    'Skipping stale queued MessageSend recovery because outbound sending is disabled for the Leadzilla demo',
  );
  return 0;
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
