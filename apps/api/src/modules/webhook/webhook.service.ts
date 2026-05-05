import type { ReplyClassifyJobPayload, ResendWebhookPayload, TrengoWebhookPayload } from '@lead-flood/contracts';
import { type Prisma, prisma } from '@lead-flood/db';

export interface WebhookProcessResult {
  feedbackEventId: string | null;
  dedupeKey: string;
  skipped: boolean;
  reason?: string | undefined;
}

export interface ResendReceivedEmail {
  id: string;
  from: string | null;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  createdAt: string | null;
}

export interface WebhookServiceDependencies {
  enqueueReplyClassify?: ((payload: ReplyClassifyJobPayload) => Promise<void>) | undefined;
  fetchResendReceivedEmail?: ((emailId: string) => Promise<ResendReceivedEmail | null>) | undefined;
}

async function enqueueReplyClassification(
  event: {
    id: string;
    leadId: string;
    messageSendId: string;
    replyText: string | null;
  },
  correlationId: string,
  deps?: WebhookServiceDependencies | undefined,
): Promise<void> {
  if (!deps?.enqueueReplyClassify) {
    return;
  }

  await deps.enqueueReplyClassify({
    runId: `reply.classify:${event.id}`,
    feedbackEventId: event.id,
    replyText: event.replyText,
    leadId: event.leadId,
    messageSendId: event.messageSendId,
    correlationId,
  });
}

/**
 * Process an inbound Trengo webhook event.
 *
 * 1. Idempotency via dedupeKey = `trengo:<message_id>`
 * 2. Correlate to a MessageSend via providerConversationId
 * 3. Create a FeedbackEvent with source=WEBHOOK, eventType=REPLIED
 * 4. Cancel pending follow-ups for this lead
 * 5. Enqueue reply classification
 * 6. On duplicate replay, re-enqueue classification if the durable reply is still unclassified
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

  // Check for duplicate delivery before doing any writes
  const existingEvent = await prisma.feedbackEvent.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      dedupeKey: true,
      leadId: true,
      messageSendId: true,
      replyText: true,
      replyClassification: true,
    },
  });

  if (existingEvent) {
    if (!existingEvent.replyClassification && existingEvent.messageSendId) {
      await enqueueReplyClassification(
        {
          id: existingEvent.id,
          leadId: existingEvent.leadId,
          messageSendId: existingEvent.messageSendId,
          replyText: existingEvent.replyText,
        },
        `webhook:trengo:${messageId}`,
        deps,
      );
    }

    return {
      feedbackEventId: existingEvent.id,
      dedupeKey: existingEvent.dedupeKey,
      skipped: true,
      reason: 'DUPLICATE_WEBHOOK',
    };
  }

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

  // Atomic: create feedback event + mark replied + cancel follow-ups
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
  await enqueueReplyClassification(
    {
      id: event.id,
      leadId: messageSend.leadId,
      messageSendId: messageSend.id,
      replyText,
    },
    `webhook:trengo:${messageId}`,
    deps,
  );

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
): 'BOUNCED' | 'NOT_INTERESTED' | 'DELIVERED' | null {
  switch (type) {
    case 'email.bounced':
      return 'BOUNCED';
    case 'email.complained':
      return 'NOT_INTERESTED';
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

function extractEmailAddress(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const angleMatch = value.match(/<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/);
  const candidate = angleMatch?.[1] ?? value;
  const normalized = candidate.trim().replace(/^mailto:/i, '').toLowerCase();
  const plainMatch = normalized.match(/[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/);
  return plainMatch?.[0] ?? null;
}

function stripHtmlToText(html: string | null | undefined): string | null {
  if (!html) {
    return null;
  }

  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();

  return text.length > 0 ? text : null;
}

function parseWebhookDate(value: string | null | undefined): Date {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function processResendReceivedWebhook(
  payload: ResendWebhookPayload,
  deps?: WebhookServiceDependencies | undefined,
): Promise<WebhookProcessResult> {
  const emailId = payload.data.email_id ?? '';
  const senderEmail = extractEmailAddress(payload.data.from);
  const fallbackStamp = payload.data.created_at ?? payload.created_at ?? '';
  const fallbackSubject = payload.data.subject ?? '';
  const dedupeKey = emailId
    ? `resend:received:${emailId}`
    : `resend:received:fallback:${senderEmail ?? 'unknown-sender'}:${fallbackStamp}:${fallbackSubject}`;

  const existingEvent = await prisma.feedbackEvent.findUnique({
    where: { dedupeKey },
    select: {
      id: true,
      dedupeKey: true,
      leadId: true,
      messageSendId: true,
      replyText: true,
      replyClassification: true,
    },
  });

  if (existingEvent) {
    if (!existingEvent.replyClassification && existingEvent.messageSendId) {
      await enqueueReplyClassification(
        {
          id: existingEvent.id,
          leadId: existingEvent.leadId,
          messageSendId: existingEvent.messageSendId,
          replyText: existingEvent.replyText,
        },
        `webhook:resend:received:${emailId || existingEvent.id}`,
        deps,
      );
    }

    return {
      feedbackEventId: existingEvent.id,
      dedupeKey: existingEvent.dedupeKey,
      skipped: true,
      reason: 'DUPLICATE_WEBHOOK',
    };
  }

  if (!senderEmail) {
    return {
      feedbackEventId: null,
      dedupeKey,
      skipped: true,
      reason: 'NO_SENDER',
    };
  }

  const lead = await prisma.lead.findUnique({
    where: { email: senderEmail, deletedAt: null },
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

  const receivedEmail = emailId && deps?.fetchResendReceivedEmail
    ? await deps.fetchResendReceivedEmail(emailId)
    : null;
  const replyText = receivedEmail?.text
    ?? stripHtmlToText(receivedEmail?.html)
    ?? '(inbound email received; body unavailable)';
  const occurredAt = parseWebhookDate(
    receivedEmail?.createdAt ?? payload.data.created_at ?? payload.created_at,
  );

  const event = await prisma.$transaction(async (tx) => {
    const feedbackEvent = await tx.feedbackEvent.upsert({
      where: { dedupeKey },
      create: {
        leadId: messageSend.leadId,
        messageSendId: messageSend.id,
        eventType: 'REPLIED',
        source: 'WEBHOOK',
        providerEventId: emailId,
        dedupeKey,
        payloadJson: JSON.parse(JSON.stringify({
          payload,
          receivedEmail: receivedEmail
            ? {
                id: receivedEmail.id,
                from: receivedEmail.from,
                to: receivedEmail.to,
                subject: receivedEmail.subject,
                createdAt: receivedEmail.createdAt,
              }
            : null,
        })) as Prisma.InputJsonValue,
        replyText,
        occurredAt,
      },
      update: {},
    });

    await tx.messageSend.update({
      where: { id: messageSend.id },
      data: {
        status: 'REPLIED',
        repliedAt: occurredAt,
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

  await enqueueReplyClassification(
    {
      id: event.id,
      leadId: messageSend.leadId,
      messageSendId: messageSend.id,
      replyText,
    },
    `webhook:resend:received:${emailId || event.id}`,
    deps,
  );

  return {
    feedbackEventId: event.id,
    dedupeKey: event.dedupeKey,
    skipped: false,
  };
}

/**
 * Process an inbound Resend webhook event.
 *
 * 1. Parse event type: email.received, email.bounced, email.complained, email.delivered
 * 2. Correlate to a MessageSend via recipient email on the Lead
 * 3. For received:
 *    - Fetch the stored email body when the Resend API key is configured
 *    - Create FeedbackEvent (REPLIED)
 *    - Update MessageSend.status to REPLIED
 *    - Cancel follow-ups (nextFollowUpAfter=null) for all pending sends on that lead
 * 4. For bounced/complained:
 *    - Create FeedbackEvent (BOUNCED or NOT_INTERESTED)
 *    - Update MessageSend.status to BOUNCED
 *    - Cancel follow-ups (nextFollowUpAfter=null) for all pending sends on that lead
 *    - Log bounce domain
 * 5. For delivered: update MessageSend.status to DELIVERED
 * 6. Idempotency via dedupeKey = `resend:<email_id>` or `resend:received:<email_id>`
 */
export async function processResendWebhook(
  payload: ResendWebhookPayload,
  deps?: WebhookServiceDependencies | undefined,
): Promise<WebhookProcessResult> {
  if (payload.type === 'email.received') {
    return processResendReceivedWebhook(payload, deps);
  }

  const emailId = payload.data.email_id ?? '';
  const recipients = payload.data.to ?? [];
  const firstRecipient = recipients[0]?.toLowerCase() ?? 'unknown-recipient';
  const fallbackStamp = payload.data.created_at ?? payload.created_at ?? '';
  const fallbackSubject = payload.data.subject ?? '';
  const dedupeKey = emailId
    ? `resend:${emailId}`
    : `resend:fallback:${payload.type}:${firstRecipient}:${fallbackStamp}:${fallbackSubject}`;
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

  // Correlate by providerMessageId (= Resend email_id) for exact match,
  // falling back to latest send for the lead if email_id is missing
  const exactMatch = emailId
    ? await prisma.messageSend.findFirst({
        where: { leadId: lead.id, channel: 'EMAIL', provider: 'RESEND', providerMessageId: emailId },
        select: { id: true, leadId: true },
      })
    : null;
  const messageSend = exactMatch ?? await prisma.messageSend.findFirst({
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

  // Handle delivered — idempotent: skip if already delivered or in a terminal state
  if (eventType === 'DELIVERED') {
    const currentSend = await prisma.messageSend.findUnique({
      where: { id: messageSend.id },
      select: { status: true },
    });

    if (currentSend?.status === 'DELIVERED' || currentSend?.status === 'REPLIED') {
      return {
        feedbackEventId: null,
        dedupeKey,
        skipped: true,
        reason: 'ALREADY_DELIVERED',
      };
    }

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

  // Handle bounced/complained — check for duplicate delivery first
  const existingResendEvent = await prisma.feedbackEvent.findUnique({
    where: { dedupeKey },
    select: { id: true, dedupeKey: true },
  });

  if (existingResendEvent) {
    return {
      feedbackEventId: existingResendEvent.id,
      dedupeKey: existingResendEvent.dedupeKey,
      skipped: true,
      reason: 'DUPLICATE_WEBHOOK',
    };
  }

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
