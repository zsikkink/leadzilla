import type { SendMessageRequest } from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';
import type { ResendAdapter, TrengoAdapter } from '@lead-flood/providers';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import type { EmailRateLimiter } from '../messaging/email-rate-limiter.js';
import type { WhatsAppRateLimiter } from '../messaging/rate-limiter.js';
import { computeNextFollowUpAfter } from '../utils/jitter.js';
import { assignAbVariant } from './message.generate.job.js';

export const MESSAGE_SEND_JOB_NAME = 'message.send';
export const MESSAGE_SEND_IDEMPOTENCY_KEY_PATTERN = 'message.send:${messageVariantId}';

export const MESSAGE_SEND_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 5,
  retryDelay: 90,
  retryBackoff: true,
  deadLetter: 'message.send.dead_letter',
};

export interface MessageSendJobPayload extends Pick<SendMessageRequest, 'messageDraftId' | 'messageVariantId' | 'idempotencyKey' | 'scheduledAt'> {
  runId: string;
  sendId: string;
  channel: 'EMAIL' | 'WHATSAPP';
  followUpNumber?: number | undefined;
  correlationId?: string | undefined;
}

export interface MessageSendLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface MessageSendJobDependencies {
  resendAdapter: ResendAdapter;
  trengoAdapter: TrengoAdapter;
  rateLimiter?: WhatsAppRateLimiter | undefined;
  emailRateLimiter?: EmailRateLimiter | undefined;
  boss?: Pick<PgBoss, 'send'> | undefined;
}

export async function handleMessageSendJob(
  logger: MessageSendLogger,
  job: Job<MessageSendJobPayload>,
  deps?: MessageSendJobDependencies,
): Promise<void> {
  const { runId, correlationId, sendId, messageDraftId, messageVariantId, idempotencyKey, channel } = job.data;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: correlationId ?? job.id,
      sendId,
      messageDraftId,
      messageVariantId,
      idempotencyKey,
      channel,
    },
    'Started message.send job',
  );

  try {
    const send = await prisma.messageSend.findUnique({
      where: { id: sendId },
      include: {
        messageVariant: true,
        lead: { select: { id: true, email: true, phone: true, firstName: true, lastName: true, deletedAt: true } },
      },
    });

    if (!send) {
      logger.error({ jobId: job.id, sendId }, 'MessageSend not found');
      return;
    }

    if (send.lead.deletedAt) {
      await markFailed(sendId, 'LEAD_DELETED', 'Lead has been soft-deleted');
      logger.warn({ jobId: job.id, sendId, leadId: send.lead.id }, 'Skipping soft-deleted lead');
      return;
    }

    if (send.status !== 'QUEUED') {
      logger.warn({ jobId: job.id, sendId, status: send.status }, 'MessageSend already processed');
      return;
    }

    // --- Global suppression check: skip leads that have bounced or unsubscribed ---
    const suppressionEvent = await prisma.feedbackEvent.findFirst({
      where: {
        leadId: send.lead.id,
        eventType: { in: ['BOUNCED', 'UNSUBSCRIBED'] },
      },
      select: { id: true, eventType: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' },
    });

    if (suppressionEvent) {
      const reason = `Lead suppressed: ${suppressionEvent.eventType} event on ${suppressionEvent.occurredAt.toISOString()}`;
      await markFailed(sendId, 'SUPPRESSED', reason);
      logger.info(
        {
          jobId: job.id,
          sendId,
          leadId: send.lead.id,
          suppressionEventId: suppressionEvent.id,
          suppressionType: suppressionEvent.eventType,
        },
        `Skipping message send — lead is on suppression list (${suppressionEvent.eventType})`,
      );
      return;
    }

    // Determine A/B variant assignment for tracking
    const abVariant = assignAbVariant(send.lead.id);
    const variantKey = send.messageVariant.variantKey ?? abVariant;

    logger.info(
      {
        jobId: job.id,
        sendId,
        leadId: send.lead.id,
        abVariant,
        variantKey,
      },
      `A/B variant assignment: ${variantKey} (ab=${abVariant})`,
    );

    const effectiveChannel = channel ?? send.channel;

    if (effectiveChannel === 'EMAIL') {
      if (!deps?.resendAdapter || !deps.resendAdapter.isConfigured) {
        await markFailed(sendId, 'PROVIDER_NOT_CONFIGURED', 'Resend adapter not available or not configured');
        logger.error({ jobId: job.id, sendId }, 'Resend adapter not configured');
        return;
      }

      // Email rate limit check
      if (deps.emailRateLimiter) {
        const rateCheck = await deps.emailRateLimiter.canSend();
        if (!rateCheck.allowed) {
          // Re-enqueue for next send window instead of failing
          if (deps.boss && rateCheck.nextWindowAt) {
            await deps.boss.send(MESSAGE_SEND_JOB_NAME, job.data, {
              singletonKey: `message.send:${sendId}:deferred`,
              startAfter: rateCheck.nextWindowAt,
              ...MESSAGE_SEND_RETRY_OPTIONS,
            });
            logger.info(
              {
                jobId: job.id,
                sendId,
                reason: rateCheck.reason,
                nextWindowAt: rateCheck.nextWindowAt.toISOString(),
              },
              'Email send rate-limited, re-enqueued for next window',
            );
          } else {
            logger.warn(
              { jobId: job.id, sendId, reason: rateCheck.reason },
              'Email send rate-limited but no boss to re-enqueue',
            );
          }
          return;
        }
      }

      // Dedup check: if this send is already SENT or DELIVERED (e.g. pg-boss retry after transient post-send failure), skip
      const alreadySent = await prisma.messageSend.findFirst({
        where: { id: sendId, status: { in: ['SENT', 'DELIVERED'] } },
      });
      if (alreadySent) {
        logger.info({ jobId: job.id, sendId }, 'Email already sent, skipping');
        return;
      }

      const result = await deps.resendAdapter.sendEmail({
        to: send.lead.email,
        subject: send.messageVariant.subject ?? `Message from Lead Flood`,
        bodyText: send.messageVariant.bodyText,
        bodyHtml: send.messageVariant.bodyHtml,
        idempotencyKey: send.idempotencyKey,
      });

      if (result.status === 'success') {
        const followUpNumber = job.data.followUpNumber ?? 0;
        const nextFollowUpAfter = computeNextFollowUpAfter(followUpNumber);

        await prisma.$transaction([
          prisma.messageSend.update({
            where: { id: sendId },
            data: {
              status: 'SENT',
              providerMessageId: result.providerMessageId,
              sentAt: new Date(),
              followUpNumber,
              nextFollowUpAfter,
            },
          }),
          ...(followUpNumber === 0
            ? [prisma.lead.update({ where: { id: send.lead.id }, data: { status: 'messaged' } })]
            : []),
        ]);

        logger.info(
          { jobId: job.id, sendId, providerMessageId: result.providerMessageId, variantKey, abVariant },
          `Email sent successfully via Resend (variant=${variantKey})`,
        );
      } else if (result.status === 'retryable_error') {
        throw new Error(`Resend retryable error: ${result.failure.message}`);
      } else {
        await markFailed(sendId, result.failure.statusCode?.toString() ?? 'TERMINAL', result.failure.message);
        logger.error({ jobId: job.id, sendId, failure: result.failure }, 'Email send failed permanently');
      }
    } else if (effectiveChannel === 'WHATSAPP') {
      if (!deps?.trengoAdapter || !deps.trengoAdapter.isConfigured) {
        await markFailed(sendId, 'PROVIDER_NOT_CONFIGURED', 'Trengo adapter not available or not configured');
        logger.error({ jobId: job.id, sendId }, 'Trengo adapter not configured');
        return;
      }

      // Guard: phone number required for WhatsApp
      if (!send.lead.phone) {
        await markFailed(sendId, 'MISSING_PHONE', 'Lead has no phone number for WhatsApp delivery');
        logger.error({ jobId: job.id, sendId, leadId: send.leadId }, 'Lead missing phone for WhatsApp');
        return;
      }

      // Rate limit check
      if (deps.rateLimiter) {
        const rateCheck = await deps.rateLimiter.canSend();
        if (!rateCheck.allowed) {
          // Re-enqueue for next send window instead of failing
          if (deps.boss && rateCheck.nextWindowAt) {
            await deps.boss.send(MESSAGE_SEND_JOB_NAME, job.data, {
              singletonKey: `message.send:${sendId}:deferred`,
              startAfter: rateCheck.nextWindowAt,
              ...MESSAGE_SEND_RETRY_OPTIONS,
            });
            logger.info(
              {
                jobId: job.id,
                sendId,
                reason: rateCheck.reason,
                nextWindowAt: rateCheck.nextWindowAt.toISOString(),
              },
              'WhatsApp send rate-limited, re-enqueued for next window',
            );
          } else {
            logger.warn(
              { jobId: job.id, sendId, reason: rateCheck.reason },
              'WhatsApp send rate-limited but no boss to re-enqueue',
            );
          }
          return;
        }
      }

      // Dedup check: if a MessageSend with this idempotencyKey is already SENT or DELIVERED, skip
      const existingSend = await prisma.messageSend.findFirst({
        where: { idempotencyKey: send.idempotencyKey, status: { in: ['SENT', 'DELIVERED'] } },
        select: { id: true, providerMessageId: true },
      });
      if (existingSend) {
        logger.info(
          { jobId: job.id, sendId, idempotencyKey: send.idempotencyKey, existingSendId: existingSend.id },
          'WhatsApp send skipped — idempotency key already sent',
        );
        return;
      }

      // Determine if this is a first-contact or follow-up by checking for existing ticketId
      const previousSend = await prisma.messageSend.findFirst({
        where: { leadId: send.leadId, channel: 'WHATSAPP', status: 'SENT', providerConversationId: { not: null } },
        select: { providerConversationId: true },
        orderBy: { sentAt: 'desc' },
      });

      const existingTicketId = previousSend?.providerConversationId ?? null;

      const result = existingTicketId
        ? await deps.trengoAdapter.sendMessage({
            ticketId: existingTicketId,
            bodyText: send.messageVariant.bodyText,
          })
        : await deps.trengoAdapter.sendTemplateMessage({
            recipientPhoneNumber: send.lead.phone,
            params: [send.lead.firstName ?? '', send.messageVariant.bodyText],
          });

      if (result.status === 'success') {
        const followUpNumber = job.data.followUpNumber ?? 0;
        const nextFollowUpAfter = computeNextFollowUpAfter(followUpNumber);
        const ticketId = result.ticketId ?? existingTicketId;

        await prisma.$transaction([
          prisma.messageSend.update({
            where: { id: sendId },
            data: {
              status: 'SENT',
              providerMessageId: result.providerMessageId,
              providerConversationId: ticketId,
              sentAt: new Date(),
              followUpNumber,
              nextFollowUpAfter,
            },
          }),
          ...(followUpNumber === 0
            ? [prisma.lead.update({ where: { id: send.lead.id }, data: { status: 'messaged' } })]
            : []),
        ]);

        logger.info(
          { jobId: job.id, sendId, providerMessageId: result.providerMessageId, variantKey, abVariant },
          `WhatsApp message sent via Trengo (variant=${variantKey})`,
        );
      } else if (result.status === 'retryable_error') {
        throw new Error(`Trengo retryable error: ${result.failure.message}`);
      } else {
        await markFailed(sendId, result.failure.statusCode?.toString() ?? 'TERMINAL', result.failure.message);
        logger.error({ jobId: job.id, sendId, failure: result.failure }, 'WhatsApp send failed permanently');
      }
    } else {
      await markFailed(sendId, 'UNSUPPORTED_CHANNEL', `Unsupported channel: ${effectiveChannel}`);
      logger.error({ jobId: job.id, sendId, channel: effectiveChannel }, 'Unsupported message channel');
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        sendId,
        messageDraftId,
        messageVariantId,
      },
      'Completed message.send job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        sendId,
        messageDraftId,
        messageVariantId,
        error,
      },
      'Failed message.send job',
    );

    throw error;
  }
}

async function markFailed(sendId: string, failureCode: string, failureReason: string): Promise<void> {
  await prisma.messageSend.update({
    where: { id: sendId },
    data: {
      status: 'FAILED',
      failureCode,
      failureReason,
    },
  });
}
