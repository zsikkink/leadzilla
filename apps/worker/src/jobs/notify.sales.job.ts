import type { NotifySalesJobPayload } from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';
import type { ResendAdapter } from '@lead-flood/providers';
import type { Job, SendOptions } from 'pg-boss';

export const NOTIFY_SALES_JOB_NAME = 'notify.sales';

export const NOTIFY_SALES_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: 'notify.sales.dead_letter',
};

export { type NotifySalesJobPayload };

export interface NotifySalesLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface NotifySalesJobDependencies {
  slackWebhookUrl?: string | undefined;
  trengoApiKey?: string | undefined;
  trengoBaseUrl?: string | undefined;
  trengoInternalConversationId?: string | undefined;
  resendAdapter?: ResendAdapter | undefined;
  salesNotificationEmail?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

function buildNotificationMessage(
  lead: { firstName: string; lastName: string; email: string },
  classification: string | null,
  unclassified: boolean,
  reason?: string | undefined,
): string {
  const name = `${lead.firstName} ${lead.lastName}`;

  if (unclassified) {
    if (reason === 'MEDIA_ONLY') {
      return `${name} (${lead.email}) replied with a voice note/media — needs manual review`;
    }
    return `${name} (${lead.email}) replied — classification failed, needs manual review`;
  }

  const classificationLabel = classification?.replace(/_/g, ' ').toLowerCase() ?? 'unknown';
  return `${name} (${lead.email}) replied — classified as ${classificationLabel}`;
}

export async function handleNotifySalesJob(
  logger: NotifySalesLogger,
  job: Job<NotifySalesJobPayload>,
  deps?: NotifySalesJobDependencies | undefined,
): Promise<void> {
  const { runId, correlationId, leadId, feedbackEventId, classification, unclassified, reason } = job.data;

  logger.info(
    { jobId: job.id, queue: job.name, runId, correlationId: correlationId ?? job.id, leadId, feedbackEventId },
    'Started notify.sales job',
  );

  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { firstName: true, lastName: true, email: true },
    });

    if (!lead) {
      logger.error({ jobId: job.id, leadId }, 'Lead not found for notification');
      return;
    }

    const message = buildNotificationMessage(lead, classification, unclassified ?? false, reason);
    const fetchFn = deps?.fetchImpl ?? fetch;
    let anyChannelSucceeded = false;
    let anyChannelConfigured = false;

    // Send to Slack
    if (deps?.slackWebhookUrl) {
      anyChannelConfigured = true;
      try {
        const slackResponse = await fetchFn(deps.slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
        });

        if (slackResponse.ok) {
          anyChannelSucceeded = true;
        } else {
          logger.warn(
            { jobId: job.id, status: slackResponse.status },
            'Slack notification failed',
          );
        }
      } catch (slackError: unknown) {
        logger.warn({ jobId: job.id, error: slackError }, 'Slack notification error');
      }
    }

    // Send to Trengo internal conversation
    if (deps?.trengoApiKey && deps.trengoInternalConversationId) {
      anyChannelConfigured = true;
      const trengoBaseUrl = deps.trengoBaseUrl ?? 'https://app.trengo.com/api/v2';
      try {
        const trengoResponse = await fetchFn(
          `${trengoBaseUrl}/conversations/${deps.trengoInternalConversationId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${deps.trengoApiKey}`,
            },
            body: JSON.stringify({
              body: message,
              internal: true,
            }),
          },
        );

        if (trengoResponse.ok) {
          anyChannelSucceeded = true;
        } else {
          logger.warn(
            { jobId: job.id, status: trengoResponse.status },
            'Trengo internal notification failed',
          );
        }
      } catch (trengoError: unknown) {
        logger.warn({ jobId: job.id, error: trengoError }, 'Trengo internal notification error');
      }
    }

    // Send via Resend email
    if (deps?.resendAdapter?.isConfigured && deps.salesNotificationEmail) {
      anyChannelConfigured = true;
      try {
        // Load additional context for rich email notification
        const latestScore = await prisma.leadScorePrediction.findFirst({
          where: { leadId },
          orderBy: [{ predictedAt: 'desc' }],
          select: { scoreBand: true, blendedScore: true },
        });
        const feedbackEvent = await prisma.feedbackEvent.findUnique({
          where: { id: feedbackEventId },
          select: { replyText: true },
        });
        const latestSend = await prisma.messageSend.findFirst({
          where: { leadId, status: { in: ['SENT', 'DELIVERED'] } },
          orderBy: { sentAt: 'desc' },
          select: { messageVariant: { select: { bodyText: true } } },
        });

        const classificationLabel = classification?.replace(/_/g, ' ') ?? 'UNCLASSIFIED';
        const scoreBand = latestScore?.scoreBand ?? 'N/A';
        const blendedScore = latestScore?.blendedScore?.toFixed(2) ?? 'N/A';
        const replyExcerpt = feedbackEvent?.replyText
          ? feedbackEvent.replyText.slice(0, 300) + (feedbackEvent.replyText.length > 300 ? '...' : '')
          : '(no text — media or voice note)';
        const originalExcerpt = latestSend?.messageVariant?.bodyText?.slice(0, 200) ?? '(not available)';

        const emailBody = [
          `Lead Reply Notification`,
          ``,
          `Lead: ${lead.firstName} ${lead.lastName} (${lead.email})`,
          `Classification: ${classificationLabel}`,
          `Score: ${scoreBand} (${blendedScore})`,
          ``,
          `--- Reply ---`,
          replyExcerpt,
          ``,
          `--- Original Message (excerpt) ---`,
          originalExcerpt,
        ].join('\n');

        const emailResult = await deps.resendAdapter.sendEmail({
          to: deps.salesNotificationEmail,
          subject: `[Lead Flood] ${classificationLabel} reply from ${lead.firstName} ${lead.lastName}`,
          bodyText: emailBody,
          bodyHtml: null,
          idempotencyKey: `notify-sales:${feedbackEventId}`,
        });

        if (emailResult.status === 'success') {
          anyChannelSucceeded = true;
        } else {
          logger.warn(
            { jobId: job.id, status: emailResult.status, failure: emailResult.failure },
            'Resend sales notification failed',
          );
        }
      } catch (emailError: unknown) {
        logger.warn({ jobId: job.id, error: emailError }, 'Resend sales notification error');
      }
    }

    if (!anyChannelSucceeded) {
      throw new Error(
        anyChannelConfigured
          ? 'All notification channels failed'
          : 'No notification channels configured',
      );
    }

    logger.info(
      { jobId: job.id, queue: job.name, runId, leadId, message },
      'Completed notify.sales job',
    );
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, queue: job.name, runId, leadId, error },
      'Failed notify.sales job',
    );
    throw error;
  }
}
