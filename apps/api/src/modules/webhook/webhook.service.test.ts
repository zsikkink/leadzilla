import type { TrengoWebhookPayload } from '@lead-flood/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const txMock = {
  feedbackEvent: {
    upsert: vi.fn(),
  },
  messageSend: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
};

const prismaMock = {
  messageSend: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  lead: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  feedbackEvent: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
}));

describe('webhook service SENDING quarantine tolerance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => Promise<unknown>) =>
      callback(txMock),
    );
  });

  it('allows Resend delivered webhook reconciliation from UNRESOLVED', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1' });
    prismaMock.messageSend.findFirst.mockResolvedValueOnce({
      id: 'send_1',
      leadId: 'lead_1',
    });
    prismaMock.messageSend.findUnique.mockResolvedValue({
      status: 'UNRESOLVED',
    });
    prismaMock.messageSend.update.mockResolvedValue({ id: 'send_1' });

    const { processResendWebhook } = await import('./webhook.service.js');

    await expect(
      processResendWebhook({
        type: 'email.delivered',
        created_at: '2026-03-21T12:00:00.000Z',
        data: {
          email_id: 'email_1',
          to: ['ada@example.com'],
          subject: 'Hello',
        },
      } as never),
    ).resolves.toEqual({
      feedbackEventId: null,
      dedupeKey: 'resend:email_1',
      skipped: false,
    });

    expect(prismaMock.messageSend.update).toHaveBeenCalledWith({
      where: { id: 'send_1' },
      data: {
        status: 'DELIVERED',
        deliveredAt: expect.any(Date),
      },
    });
  });

  it('records inbound Resend email replies and enqueues reply classification', async () => {
    prismaMock.feedbackEvent.findUnique.mockResolvedValue(null);
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1' });
    prismaMock.messageSend.findFirst.mockResolvedValueOnce({
      id: 'send_1',
      leadId: 'lead_1',
    });
    txMock.feedbackEvent.upsert.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'resend:received:received_1',
    });
    txMock.messageSend.update.mockResolvedValue({ id: 'send_1' });
    txMock.messageSend.updateMany.mockResolvedValue({ count: 1 });
    const fetchResendReceivedEmail = vi.fn().mockResolvedValue({
      id: 'received_1',
      from: 'Ada <ada@example.com>',
      to: ['outbound@leadzilla.example'],
      subject: 'Re: Hello',
      text: 'Yes, tell me more.',
      html: null,
      createdAt: '2026-05-04T20:00:00.000Z',
    });
    const enqueueReplyClassify = vi.fn().mockResolvedValue(undefined);

    const { processResendWebhook } = await import('./webhook.service.js');

    await expect(
      processResendWebhook(
        {
          type: 'email.received',
          created_at: '2026-05-04T20:00:01.000Z',
          data: {
            email_id: 'received_1',
            from: 'Ada <ada@example.com>',
            to: ['outbound@leadzilla.example'],
            subject: 'Re: Hello',
            created_at: '2026-05-04T20:00:00.000Z',
          },
        } as never,
        {
          fetchResendReceivedEmail,
          enqueueReplyClassify,
        },
      ),
    ).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'resend:received:received_1',
      skipped: false,
    });

    expect(fetchResendReceivedEmail).toHaveBeenCalledWith('received_1');
    expect(prismaMock.lead.findUnique).toHaveBeenCalledWith({
      where: { email: 'ada@example.com', deletedAt: null },
      select: { id: true },
    });
    expect(txMock.feedbackEvent.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: 'resend:received:received_1' },
      create: expect.objectContaining({
        leadId: 'lead_1',
        messageSendId: 'send_1',
        eventType: 'REPLIED',
        source: 'WEBHOOK',
        providerEventId: 'received_1',
        dedupeKey: 'resend:received:received_1',
        replyText: 'Yes, tell me more.',
        occurredAt: new Date('2026-05-04T20:00:00.000Z'),
      }),
      update: {},
    });
    expect(txMock.messageSend.update).toHaveBeenCalledWith({
      where: { id: 'send_1' },
      data: {
        status: 'REPLIED',
        repliedAt: new Date('2026-05-04T20:00:00.000Z'),
      },
    });
    expect(txMock.messageSend.updateMany).toHaveBeenCalledWith({
      where: {
        leadId: 'lead_1',
        nextFollowUpAfter: { not: null },
      },
      data: { nextFollowUpAfter: null },
    });
    expect(enqueueReplyClassify).toHaveBeenCalledWith({
      runId: 'reply.classify:feedback_1',
      feedbackEventId: 'feedback_1',
      replyText: 'Yes, tell me more.',
      leadId: 'lead_1',
      messageSendId: 'send_1',
      correlationId: 'webhook:resend:received:received_1',
    });
  });

  it('recovers a failed post-commit Resend reply classify enqueue on duplicate replay', async () => {
    prismaMock.feedbackEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'feedback_1',
        dedupeKey: 'resend:received:received_1',
        leadId: 'lead_1',
        messageSendId: 'send_1',
        replyText: 'Yes, tell me more.',
        replyClassification: null,
      });
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1' });
    prismaMock.messageSend.findFirst.mockResolvedValueOnce({
      id: 'send_1',
      leadId: 'lead_1',
    });
    txMock.feedbackEvent.upsert.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'resend:received:received_1',
    });
    txMock.messageSend.update.mockResolvedValue({ id: 'send_1' });
    txMock.messageSend.updateMany.mockResolvedValue({ count: 1 });
    const fetchResendReceivedEmail = vi.fn().mockResolvedValue({
      id: 'received_1',
      from: 'ada@example.com',
      to: ['outbound@leadzilla.example'],
      subject: 'Re: Hello',
      text: 'Yes, tell me more.',
      html: null,
      createdAt: '2026-05-04T20:00:00.000Z',
    });
    const enqueueReplyClassify = vi.fn()
      .mockRejectedValueOnce(new Error('pg-boss unavailable'))
      .mockResolvedValueOnce(undefined);

    const { processResendWebhook } = await import('./webhook.service.js');
    const payload = {
      type: 'email.received',
      created_at: '2026-05-04T20:00:01.000Z',
      data: {
        email_id: 'received_1',
        from: 'ada@example.com',
        to: ['outbound@leadzilla.example'],
        subject: 'Re: Hello',
        created_at: '2026-05-04T20:00:00.000Z',
      },
    };

    await expect(
      processResendWebhook(payload as never, {
        fetchResendReceivedEmail,
        enqueueReplyClassify,
      }),
    ).rejects.toThrow('pg-boss unavailable');

    await expect(
      processResendWebhook(payload as never, {
        fetchResendReceivedEmail,
        enqueueReplyClassify,
      }),
    ).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'resend:received:received_1',
      skipped: true,
      reason: 'DUPLICATE_WEBHOOK',
    });

    expect(fetchResendReceivedEmail).toHaveBeenCalledTimes(1);
    expect(enqueueReplyClassify).toHaveBeenNthCalledWith(2, {
      runId: 'reply.classify:feedback_1',
      feedbackEventId: 'feedback_1',
      replyText: 'Yes, tell me more.',
      leadId: 'lead_1',
      messageSendId: 'send_1',
      correlationId: 'webhook:resend:received:received_1',
    });
    expect(prismaMock.messageSend.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('allows Trengo reply webhook reconciliation from UNRESOLVED', async () => {
    const payload: TrengoWebhookPayload = {
      event: 'message.created',
      data: {
        id: 1,
        conversation_id: 42,
        contact: { phone: '+15555550123' },
        message: { body: 'reply text' },
      },
    };

    prismaMock.messageSend.findFirst.mockResolvedValue({
      id: 'send_1',
      leadId: 'lead_1',
    });
    prismaMock.feedbackEvent.findUnique.mockResolvedValue(null);
    txMock.feedbackEvent.upsert.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'trengo:1',
    });
    txMock.messageSend.update.mockResolvedValue({ id: 'send_1' });
    txMock.messageSend.updateMany.mockResolvedValue({ count: 0 });

    const { processTrengoWebhook } = await import('./webhook.service.js');

    await expect(processTrengoWebhook(payload)).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'trengo:1',
      skipped: false,
    });

    expect(txMock.messageSend.update).toHaveBeenCalledWith({
      where: { id: 'send_1' },
      data: {
        status: 'REPLIED',
        repliedAt: expect.any(Date),
      },
    });
  });

  it('recovers a failed post-commit Trengo classify enqueue on duplicate replay', async () => {
    const payload: TrengoWebhookPayload = {
      event: 'message.created',
      data: {
        id: 1,
        conversation_id: 42,
        contact: { phone: '+15555550123' },
        message: { body: 'reply text' },
      },
    };

    prismaMock.feedbackEvent.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'feedback_1',
        dedupeKey: 'trengo:1',
        leadId: 'lead_1',
        messageSendId: 'send_1',
        replyText: 'reply text',
        replyClassification: null,
      });
    prismaMock.messageSend.findFirst.mockResolvedValue({
      id: 'send_1',
      leadId: 'lead_1',
    });
    txMock.feedbackEvent.upsert.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'trengo:1',
    });
    txMock.messageSend.update.mockResolvedValue({ id: 'send_1' });
    txMock.messageSend.updateMany.mockResolvedValue({ count: 0 });
    const enqueueReplyClassify = vi.fn()
      .mockRejectedValueOnce(new Error('pg-boss unavailable'))
      .mockResolvedValueOnce(undefined);

    const { processTrengoWebhook } = await import('./webhook.service.js');

    await expect(
      processTrengoWebhook(payload, { enqueueReplyClassify }),
    ).rejects.toThrow('pg-boss unavailable');

    await expect(
      processTrengoWebhook(payload, { enqueueReplyClassify }),
    ).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'trengo:1',
      skipped: true,
      reason: 'DUPLICATE_WEBHOOK',
    });

    expect(enqueueReplyClassify).toHaveBeenNthCalledWith(1, {
      runId: 'reply.classify:feedback_1',
      feedbackEventId: 'feedback_1',
      replyText: 'reply text',
      leadId: 'lead_1',
      messageSendId: 'send_1',
      correlationId: 'webhook:trengo:1',
    });
    expect(enqueueReplyClassify).toHaveBeenNthCalledWith(2, {
      runId: 'reply.classify:feedback_1',
      feedbackEventId: 'feedback_1',
      replyText: 'reply text',
      leadId: 'lead_1',
      messageSendId: 'send_1',
      correlationId: 'webhook:trengo:1',
    });
    expect(prismaMock.messageSend.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not re-enqueue reply classification on duplicate Trengo replay when classification already exists', async () => {
    const payload: TrengoWebhookPayload = {
      event: 'message.created',
      data: {
        id: 1,
        conversation_id: 42,
        contact: { phone: '+15555550123' },
        message: { body: 'reply text' },
      },
    };

    prismaMock.feedbackEvent.findUnique.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'trengo:1',
      leadId: 'lead_1',
      messageSendId: 'send_1',
      replyText: 'reply text',
      replyClassification: 'INTERESTED',
    });
    const enqueueReplyClassify = vi.fn().mockResolvedValue(undefined);

    const { processTrengoWebhook } = await import('./webhook.service.js');

    await expect(
      processTrengoWebhook(payload, { enqueueReplyClassify }),
    ).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'trengo:1',
      skipped: true,
      reason: 'DUPLICATE_WEBHOOK',
    });

    expect(enqueueReplyClassify).not.toHaveBeenCalled();
    expect(prismaMock.messageSend.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('allows Resend bounce reconciliation from UNRESOLVED', async () => {
    prismaMock.lead.findUnique.mockResolvedValue({ id: 'lead_1' });
    prismaMock.messageSend.findFirst.mockResolvedValueOnce({
      id: 'send_1',
      leadId: 'lead_1',
    });
    prismaMock.feedbackEvent.findUnique.mockResolvedValue(null);
    txMock.feedbackEvent.upsert.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'resend:email_1',
    });
    txMock.messageSend.update.mockResolvedValue({ id: 'send_1' });
    txMock.messageSend.updateMany.mockResolvedValue({ count: 0 });

    const { processResendWebhook } = await import('./webhook.service.js');

    await expect(
      processResendWebhook({
        type: 'email.bounced',
        created_at: '2026-03-21T12:00:00.000Z',
        data: {
          email_id: 'email_1',
          to: ['ada@example.com'],
          subject: 'Hello',
          bounce: { message: 'hard bounce' },
        },
      } as never),
    ).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'resend:email_1',
      skipped: false,
      reason: 'bounce_domain:example.com',
    });

    expect(txMock.messageSend.update).toHaveBeenCalledWith({
      where: { id: 'send_1' },
      data: {
        status: 'BOUNCED',
        failureCode: 'HARD_BOUNCE',
        failureReason: 'hard bounce',
      },
    });
  });
});
