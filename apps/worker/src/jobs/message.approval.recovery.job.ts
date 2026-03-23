import prismaClientPkg from '@prisma/client';
import { prisma } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import {
  MESSAGE_SEND_JOB_NAME,
  MESSAGE_SEND_RETRY_OPTIONS,
  type MessageSendJobPayload,
} from './message.send.job.js';

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

export const STALE_APPROVED_DRAFT_THRESHOLD_MS = 10 * 60 * 1000;
const STALE_APPROVED_DRAFT_BATCH_SIZE = 100;

const { Prisma: PrismaClient } = prismaClientPkg;

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

interface RecoverableApprovedDraftVariant {
  id: string;
  channel: 'EMAIL' | 'WHATSAPP';
  isSelected: boolean;
}

interface RecoverableApprovedDraft {
  id: string;
  leadId: string;
  approvedAt: Date | null;
  variants: RecoverableApprovedDraftVariant[];
}

interface RecoverableMessageSend {
  id: string;
  messageDraftId: string;
  messageVariantId: string;
  idempotencyKey: string;
  channel: 'EMAIL' | 'WHATSAPP';
  scheduledAt: Date | null;
  status: 'QUEUED' | 'SENDING' | 'UNRESOLVED' | 'SENT' | 'DELIVERED' | 'REPLIED' | 'BOUNCED' | 'FAILED';
}

function selectApprovalVariant(draft: RecoverableApprovedDraft): RecoverableApprovedDraftVariant | null {
  return draft.variants.find((variant) => variant.isSelected) ?? draft.variants[0] ?? null;
}

function buildApprovalIdempotencyKey(draftId: string, variantId: string): string {
  return `approve:${draftId}:${variantId}`;
}

function buildRecoveredMessageSendPayload(send: RecoverableMessageSend): MessageSendJobPayload {
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

async function enqueueQueuedMessageSend(
  send: RecoverableMessageSend,
  deps: MessageApprovalRecoveryJobDependencies,
  now: Date,
): Promise<void> {
  const startAfter =
    send.scheduledAt && send.scheduledAt.getTime() > now.getTime()
      ? send.scheduledAt
      : undefined;

  await deps.boss.send(MESSAGE_SEND_JOB_NAME, buildRecoveredMessageSendPayload(send), {
    singletonKey: `message.send:${send.id}`,
    ...MESSAGE_SEND_RETRY_OPTIONS,
    ...(startAfter ? { startAfter } : {}),
  });
}

async function findExistingInitialSendForDraft(draftId: string): Promise<RecoverableMessageSend | null> {
  return prisma.messageSend.findFirst({
    where: {
      messageDraftId: draftId,
      followUpNumber: 0,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      messageDraftId: true,
      messageVariantId: true,
      idempotencyKey: true,
      channel: true,
      scheduledAt: true,
      status: true,
    },
  });
}

async function findSendByIdempotencyKey(idempotencyKey: string): Promise<RecoverableMessageSend | null> {
  return prisma.messageSend.findUnique({
    where: { idempotencyKey },
    select: {
      id: true,
      messageDraftId: true,
      messageVariantId: true,
      idempotencyKey: true,
      channel: true,
      scheduledAt: true,
      status: true,
    },
  });
}

function isUniqueIdempotencyConflict(error: unknown): boolean {
  return error instanceof PrismaClient.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function recoverApprovedInitialDraftsMissingMessageSends(
  logger: MessageApprovalRecoveryLogger,
  deps: MessageApprovalRecoveryJobDependencies,
  now: Date = new Date(),
): Promise<number> {
  const approvedBefore = new Date(now.getTime() - STALE_APPROVED_DRAFT_THRESHOLD_MS);

  const drafts = await prisma.messageDraft.findMany({
    where: {
      followUpNumber: 0,
      approvalStatus: 'APPROVED',
      approvedAt: { lt: approvedBefore },
      variants: { some: {} },
      messageSends: {
        none: {
          followUpNumber: 0,
        },
      },
    },
    orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }],
    take: STALE_APPROVED_DRAFT_BATCH_SIZE,
    select: {
      id: true,
      leadId: true,
      approvedAt: true,
      variants: {
        orderBy: [{ variantKey: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          channel: true,
          isSelected: true,
        },
      },
    },
  });

  let recoveredCount = 0;

  for (const draft of drafts) {
    const selectedVariant = selectApprovalVariant(draft);
    if (!selectedVariant) {
      logger.warn(
        {
          draftId: draft.id,
          approvedAt: draft.approvedAt?.toISOString() ?? null,
        },
        'Skipping approved draft recovery because no variant is available',
      );
      continue;
    }

    const idempotencyKey = buildApprovalIdempotencyKey(draft.id, selectedVariant.id);
    const existingSend = await findExistingInitialSendForDraft(draft.id);
    if (existingSend) {
      if (existingSend.status === 'QUEUED') {
        try {
          await enqueueQueuedMessageSend(existingSend, deps, now);
        } catch (error: unknown) {
          logger.error(
            {
              error,
              draftId: draft.id,
              sendId: existingSend.id,
            },
            'Failed to enqueue existing initial MessageSend during manual approval recovery',
          );
        }
      }

      logger.info(
        {
          draftId: draft.id,
          sendId: existingSend.id,
          sendStatus: existingSend.status,
        },
        'Initial MessageSend already exists for approved draft, skipping manual approval recovery',
      );
      continue;
    }

    let sendRecord: RecoverableMessageSend | null = null;
    let createdSend = false;
    try {
      sendRecord = await prisma.messageSend.create({
        data: {
          leadId: draft.leadId,
          messageDraftId: draft.id,
          messageVariantId: selectedVariant.id,
          channel: selectedVariant.channel,
          provider: selectedVariant.channel === 'WHATSAPP' ? 'TRENGO' : 'RESEND',
          status: 'QUEUED',
          idempotencyKey,
          followUpNumber: 0,
        },
        select: {
          id: true,
          messageDraftId: true,
          messageVariantId: true,
          idempotencyKey: true,
          channel: true,
          scheduledAt: true,
          status: true,
        },
      });
      createdSend = true;
    } catch (error: unknown) {
      if (!isUniqueIdempotencyConflict(error)) {
        throw error;
      }

      sendRecord = await findSendByIdempotencyKey(idempotencyKey);
      if (!sendRecord) {
        logger.warn(
          {
            draftId: draft.id,
            idempotencyKey,
          },
          'Manual approval recovery saw a duplicate send create race, but the conflicting MessageSend was not readable yet',
        );
        continue;
      }

      logger.info(
        {
          draftId: draft.id,
          sendId: sendRecord.id,
          idempotencyKey,
        },
        'Manual approval recovery encountered an existing MessageSend with the canonical approval idempotency key',
      );
    }

    if (sendRecord.status === 'QUEUED') {
      try {
        await enqueueQueuedMessageSend(sendRecord, deps, now);
      } catch (error: unknown) {
        logger.error(
          {
            error,
            draftId: draft.id,
            sendId: sendRecord.id,
          },
          'Failed to enqueue recovered initial MessageSend after manual approval recovery',
        );
      }
    }

    if (createdSend) {
      recoveredCount += 1;
      logger.info(
        {
          draftId: draft.id,
          sendId: sendRecord.id,
          messageVariantId: sendRecord.messageVariantId,
          idempotencyKey: sendRecord.idempotencyKey,
        },
        'Recovered missing initial MessageSend for approved draft',
      );
    }
  }

  logger.info(
    {
      approvedBefore: approvedBefore.toISOString(),
      recoveredCount,
      scannedCount: drafts.length,
    },
    'Completed manual approval MessageSend recovery',
  );

  return recoveredCount;
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
