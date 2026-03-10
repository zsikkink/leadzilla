import type { NotifySalesJobPayload, ReplyClassifyJobPayload } from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';
import type { OpenAiAdapter } from '@lead-flood/providers';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { RetryableError } from '../errors.js';
import { computeOooFollowUpAfter } from '../utils/jitter.js';
import { recordPipelineEvent } from '../utils/pipeline-events.js';

export const REPLY_CLASSIFY_JOB_NAME = 'reply.classify';

export const REPLY_CLASSIFY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'reply.classify.dead_letter',
};

export { type ReplyClassifyJobPayload };

export interface ReplyClassifyLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface ReplyClassifyJobDependencies {
  openAiAdapter: OpenAiAdapter;
  boss: Pick<PgBoss, 'send'>;
  notifySalesJobName: string;
  notifySalesRetryOptions: Pick<SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'>;
}

async function cancelFollowUps(leadId: string): Promise<void> {
  await prisma.messageSend.updateMany({
    where: {
      leadId,
      nextFollowUpAfter: { not: null },
    },
    data: { nextFollowUpAfter: null },
  });
}

export async function handleReplyClassifyJob(
  logger: ReplyClassifyLogger,
  job: Job<ReplyClassifyJobPayload>,
  deps: ReplyClassifyJobDependencies,
): Promise<void> {
  const { runId, correlationId, feedbackEventId, replyText, leadId, messageSendId } = job.data;
  const startMs = Date.now();

  logger.info(
    { jobId: job.id, queue: job.name, runId, correlationId: correlationId ?? job.id, feedbackEventId, leadId },
    'Started reply.classify job',
  );

  try {
    // Idempotency: skip if already classified (e.g. duplicate Trengo webhook)
    const existingEvent = await prisma.feedbackEvent.findUnique({
      where: { id: feedbackEventId },
      select: { replyClassification: true },
    });
    if (existingEvent?.replyClassification) {
      logger.info({ jobId: job.id, feedbackEventId }, 'Already classified, skipping');
      return;
    }

    // Skip soft-deleted leads
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { deletedAt: true },
    });
    if (!lead || lead.deletedAt) {
      logger.warn({ jobId: job.id, feedbackEventId, leadId }, lead?.deletedAt ? 'Skipping soft-deleted lead' : 'Lead not found');
      return;
    }

    // Voice note / media-only: no text to classify
    if (!replyText || replyText.trim().length === 0) {
      await prisma.lead.update({ where: { id: leadId }, data: { status: 'replied' } });
      await cancelFollowUps(leadId);

      const notifyPayload: NotifySalesJobPayload = {
        runId: `notify.sales:${feedbackEventId}`,
        leadId,
        feedbackEventId,
        classification: null,
        unclassified: true,
        reason: 'MEDIA_ONLY',
        correlationId: correlationId ?? job.id,
      };

      await deps.boss.send(deps.notifySalesJobName, notifyPayload, {
        ...deps.notifySalesRetryOptions,
        singletonKey: `notify.sales:${feedbackEventId}`,
      });

      await recordPipelineEvent({
        leadId,
        stage: 'REPLY_CLASSIFY',
        status: 'MEDIA_ONLY',
        jobId: job.id,
        durationMs: Date.now() - startMs,
        metadata: { feedbackEventId, reason: 'MEDIA_ONLY' },
      });

      logger.info(
        { jobId: job.id, feedbackEventId, leadId },
        'Media-only reply — marked replied, notifying team',
      );
      return;
    }

    // Classify via OpenAI
    const result = await deps.openAiAdapter.classifyReply(replyText);

    if (result.status !== 'success') {
      const errorType = result.status === 'retryable_error' ? 'retryable' : 'terminal';
      logger.error(
        { jobId: job.id, feedbackEventId, errorType, failure: result.failure },
        'OpenAI classification failed',
      );

      if (result.status === 'retryable_error') {
        throw new RetryableError(`OpenAI retryable: ${result.failure.message}`);
      }

      // Terminal error: mark as replied (safe default), notify team for manual review
      await prisma.lead.update({ where: { id: leadId }, data: { status: 'replied' } });
      await cancelFollowUps(leadId);

      await recordPipelineEvent({
        leadId,
        stage: 'REPLY_CLASSIFY',
        status: 'CLASSIFICATION_FAILED',
        jobId: job.id,
        durationMs: Date.now() - startMs,
        metadata: { feedbackEventId, failure: result.failure.message },
      });

      await deps.boss.send(
        deps.notifySalesJobName,
        {
          runId: `notify.sales:${feedbackEventId}`,
          leadId,
          feedbackEventId,
          classification: null,
          unclassified: true,
          reason: 'CLASSIFICATION_FAILED',
          correlationId: correlationId ?? job.id,
        } satisfies NotifySalesJobPayload,
        {
          ...deps.notifySalesRetryOptions,
          singletonKey: `notify.sales:${feedbackEventId}`,
        },
      );
      return;
    }

    const classification = result.data.classification;

    // Update FeedbackEvent with classification
    await prisma.feedbackEvent.update({
      where: { id: feedbackEventId },
      data: { replyClassification: classification },
    });

    // Side effects by classification
    switch (classification) {
      case 'INTERESTED': {
        await prisma.lead.update({ where: { id: leadId }, data: { status: 'replied' } });
        await cancelFollowUps(leadId);
        await deps.boss.send(
          deps.notifySalesJobName,
          {
            runId: `notify.sales:${feedbackEventId}`,
            leadId,
            feedbackEventId,
            classification,
            correlationId: correlationId ?? job.id,
          } satisfies NotifySalesJobPayload,
          {
            ...deps.notifySalesRetryOptions,
            singletonKey: `notify.sales:${feedbackEventId}`,
          },
        );
        break;
      }

      case 'NOT_INTERESTED':
      case 'UNSUBSCRIBE': {
        await prisma.lead.update({ where: { id: leadId }, data: { status: 'cold' } });
        await cancelFollowUps(leadId);

        // Write suppression record so message.send blocks future sends
        if (classification === 'UNSUBSCRIBE') {
          await prisma.feedbackEvent.create({
            data: {
              leadId,
              messageSendId: messageSendId ?? null,
              eventType: 'UNSUBSCRIBED',
              source: 'MANUAL',
              replyClassification: 'UNSUBSCRIBE',
              dedupeKey: `unsubscribe:${feedbackEventId}`,
              occurredAt: new Date(),
            },
          });
        }
        break;
      }

      case 'OUT_OF_OFFICE': {
        // Re-schedule follow-up for 7 days + jitter from now
        // Use messageSendId directly — by the time classification runs,
        // the webhook has already set its status to REPLIED.
        if (messageSendId) {
          await prisma.messageSend.update({
            where: { id: messageSendId },
            data: { nextFollowUpAfter: computeOooFollowUpAfter() },
          });
        }
        break;
      }
    }

    await recordPipelineEvent({
      leadId,
      stage: 'REPLY_CLASSIFY',
      status: classification,
      jobId: job.id,
      durationMs: Date.now() - startMs,
      metadata: { feedbackEventId, classification, confidence: result.data.confidence },
    });

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        feedbackEventId,
        leadId,
        classification,
        confidence: result.data.confidence,
      },
      'Completed reply.classify job',
    );
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, queue: job.name, runId, feedbackEventId, leadId, error },
      'Failed reply.classify job',
    );
    throw error;
  }
}
