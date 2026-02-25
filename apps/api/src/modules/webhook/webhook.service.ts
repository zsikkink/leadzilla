import type { ReplyClassifyJobPayload, ResendWebhookPayload, TrengoWebhookPayload } from '@lead-flood/contracts';
import { type Prisma, prisma } from '@lead-flood/db';

export interface WebhookProcessResult {
  feedbackEventId: string | null;
  dedupeKey: string;
  skipped: boolean;
  reason?: string | undefined;
}

export interface WebhookServiceDependencies {
  enqueueReplyClassify?: ((payload: ReplyClassifyJobPayload) => Promise<void>) | undefined;
}

/**
 * Process an inbound Trengo webhook event.
 *
 * 1. Correlate to a MessageSend via providerConversationId
 * 2. Create a FeedbackEvent with source=WEBHOOK, eventType=REPLIED
 * 3. Idempotency via dedupeKey = `trengo:<message_id>`
 * 4. Cancel pending follow-ups for this lead
 * 5. Enqueue reply classification
 */
export async function processTrengoWebhook(
  payload: TrengoWebhookPayload,
  deps?: WebhookServiceDependencies | undefined,
): Promise<WebhookProcessResult> {
  const messageId = payload.data.id;
  const dedupeKey = `trengo:${messageId}`;
  const conversationId = payload.data.conversation_id;
  const contactPhone = payload.data.contact?.phone ?? null;
  const replyText = payload.data.message?.body ?? null;

  // Find the correlated MessageSend
  let messageSend: { id: string; leadId: string } | null = null;

  if (conversationId) {
    messageSend = await prisma.messageSend.findFirst({
      where: { providerConversationId: String(conversationId) },
      select: { id: true, leadId: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Fallback: try to correlate by phone number on the lead
  if (!messageSend && contactPhone) {
    const lead = await prisma.lead.findFirst({
      where: { phone: contactPhone, deletedAt: null },
      select: { id: true },
    });
    if (lead) {
      const latestSend = await prisma.messageSend.findFirst({
        where: { leadId: lead.id, channel: 'WHATSAPP' },
        select: { id: true, leadId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (latestSend) {
        messageSend = latestSend;
      }
    }
  }

  if (!messageSend) {
    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: true,
      reason: 'NO_CORRELATED_MESSAGE_SEND',
    };
  }

  // Atomic: upsert feedback event + mark replied + cancel follow-ups
  const event = await prisma.$transaction(async (tx) => {
    const feedbackEvent = await tx.feedbackEvent.upsert({
      where: { dedupeKey },
      create: {
        leadId: messageSend.leadId,
        messageSendId: messageSend.id,
        eventType: 'REPLIED',
        source: 'WEBHOOK',
        providerEventId: String(messageId),
        dedupeKey,
        payloadJson: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
        replyText,
        occurredAt: new Date(),
      },
      update: {},
    });

    await tx.messageSend.update({
      where: { id: messageSend.id },
      data: {
        status: 'REPLIED',
        repliedAt: new Date(),
      },
    });

    await tx.messageSend.updateMany({
      where: {
        leadId: messageSend.leadId,
        nextFollowUpAfter: { not: null },
      },
      data: { nextFollowUpAfter: null },
    });

    return feedbackEvent;
  });

  // Enqueue reply classification (outside transaction — pg-boss is separate)
  if (deps?.enqueueReplyClassify) {
    await deps.enqueueReplyClassify({
      runId: `reply.classify:${event.id}`,
      feedbackEventId: event.id,
      replyText,
      leadId: messageSend.leadId,
      messageSendId: messageSend.id,
      correlationId: `webhook:trengo:${messageId}`,
    });
  }

  return {
    feedbackEventId: event.id,
    dedupeKey: event.dedupeKey,
    skipped: false,
  };
}

// --- Resend webhook processing ---

/** Map Resend event types to our FeedbackEventType */
function mapResendEventType(
  type: string,
): 'BOUNCED' | 'UNSUBSCRIBED' | 'DELIVERED' | null {
  switch (type) {
    case 'email.bounced':
      return 'BOUNCED';
    case 'email.complained':
      return 'UNSUBSCRIBED';
    case 'email.delivered':
      return 'DELIVERED';
    default:
      return null;
  }
}

function extractDomain(email: string): string | null {
  const atIndex = email.lastIndexOf('@');
  if (atIndex < 0) return null;
  return email.slice(atIndex + 1).toLowerCase();
}

/**
 * Process an inbound Resend webhook event.
 *
 * 1. Parse event type: email.bounced, email.complained, email.delivered
 * 2. Correlate to a MessageSend via recipient email on the Lead
 * 3. For bounced/complained:
 *    - Create FeedbackEvent (BOUNCED or UNSUBSCRIBED)
 *    - Update MessageSend.status to BOUNCED
 *    - Cancel follow-ups (nextFollowUpAfter=null) for all pending sends on that lead
 *    - Log bounce domain
 * 4. For delivered: update MessageSend.status to DELIVERED
 * 5. Idempotency via dedupeKey = `resend:<email_id>`
 */
export async function processResendWebhook(
  payload: ResendWebhookPayload,
): Promise<WebhookProcessResult> {
  const emailId = payload.data.email_id ?? '';
  const dedupeKey = `resend:${emailId}`;
  const eventType = mapResendEventType(payload.type);

  if (!eventType) {
    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: true,
      reason: 'UNSUPPORTED_EVENT_TYPE',
    };
  }

  // Get recipient email(s) from the payload
  const recipients = payload.data.to ?? [];
  if (recipients.length === 0) {
    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: true,
      reason: 'NO_RECIPIENTS',
    };
  }

  // Correlate to a MessageSend via the lead's email
  const recipientEmail = recipients[0]!;
  const lead = await prisma.lead.findUnique({
    where: { email: recipientEmail, deletedAt: null },
    select: { id: true },
  });

  if (!lead) {
    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: true,
      reason: 'NO_CORRELATED_LEAD',
    };
  }

  const messageSend = await prisma.messageSend.findFirst({
    where: { leadId: lead.id, channel: 'EMAIL', provider: 'RESEND' },
    select: { id: true, leadId: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!messageSend) {
    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: true,
      reason: 'NO_CORRELATED_MESSAGE_SEND',
    };
  }

  // Handle delivered — just update status, no feedback event
  if (eventType === 'DELIVERED') {
    await prisma.messageSend.update({
      where: { id: messageSend.id },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });

    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: false,
    };
  }

  // Handle bounced/complained — create feedback event, update status, cancel follow-ups
  const bounceDomain = extractDomain(recipientEmail);

  const event = await prisma.$transaction(async (tx) => {
    const feedbackEvent = await tx.feedbackEvent.upsert({
      where: { dedupeKey },
      create: {
        leadId: messageSend.leadId,
        messageSendId: messageSend.id,
        eventType,
        source: 'WEBHOOK',
        providerEventId: emailId,
        dedupeKey,
        payloadJson: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
        occurredAt: payload.created_at ? new Date(payload.created_at) : new Date(),
      },
      update: {},
    });

    // Mark the message as BOUNCED
    await tx.messageSend.update({
      where: { id: messageSend.id },
      data: {
        status: 'BOUNCED',
        failureCode: eventType === 'BOUNCED' ? 'HARD_BOUNCE' : 'COMPLAINT',
        failureReason: payload.data.bounce?.message ?? `${payload.type} received`,
      },
    });

    // Cancel all pending follow-ups for this lead
    await tx.messageSend.updateMany({
      where: {
        leadId: messageSend.leadId,
        nextFollowUpAfter: { not: null },
      },
      data: { nextFollowUpAfter: null },
    });

    return feedbackEvent;
  });

  // Log bounce domain for monitoring (structured log field consumed by caller)
  if (bounceDomain) {
    // Caller logs this via request.log.info — we surface it in the result
    // No separate logger import needed; the route handler logs the result
  }

  return {
    feedbackEventId: event.id,
    dedupeKey: event.dedupeKey,
    skipped: false,
    reason: bounceDomain ? `bounce_domain:${bounceDomain}` : undefined,
  };
}
