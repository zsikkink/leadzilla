import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

export const MESSAGE_APPROVAL_RECOVERY_JOB_NAME = 'message.approval.recovery';

export const MESSAGE_APPROVAL_RECOVERY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'message.approval.recovery.dead_letter',
};

export interface MessageApprovalRecoveryJobPayload {
  correlationId?: string | undefined;
}

export interface MessageApprovalRecoveryLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface MessageApprovalRecoveryJobDependencies {
  boss: Pick<PgBoss, 'send'>;
}

export async function recoverApprovedInitialDraftsMissingMessageSends(
  logger: MessageApprovalRecoveryLogger,
  deps: MessageApprovalRecoveryJobDependencies,
  now: Date = new Date(),
): Promise<number> {
  void deps;
  void now;
  logger.warn(
    {},
    'Skipping manual approval MessageSend recovery because outbound sending is disabled for the Leadzilla demo',
  );
  return 0;
}

export async function handleMessageApprovalRecoveryJob(
  logger: MessageApprovalRecoveryLogger,
  job: Job<MessageApprovalRecoveryJobPayload>,
  deps: MessageApprovalRecoveryJobDependencies,
): Promise<void> {
  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      correlationId: job.data.correlationId ?? job.id,
    },
    'Started manual approval MessageSend recovery job',
  );

  try {
    const recoveredCount = await recoverApprovedInitialDraftsMissingMessageSends(logger, deps);

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        correlationId: job.data.correlationId ?? job.id,
        recoveredCount,
      },
      'Completed manual approval MessageSend recovery job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        correlationId: job.data.correlationId ?? job.id,
        error,
      },
      'Failed manual approval MessageSend recovery job',
    );
    throw error;
  }
}
