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

  it('allows Trengo reply webhook reconciliation from UNRESOLVED', async () => {
    prismaMock.messageSend.findFirst.mockResolvedValue({
      id: 'send_1',
      leadId: 'lead_1',
    });
    prismaMock.feedbackEvent.findUnique.mockResolvedValue(null);
    txMock.feedbackEvent.upsert.mockResolvedValue({
      id: 'feedback_1',
      dedupeKey: 'trengo:msg_1',
    });
    txMock.messageSend.update.mockResolvedValue({ id: 'send_1' });
    txMock.messageSend.updateMany.mockResolvedValue({ count: 0 });

    const { processTrengoWebhook } = await import('./webhook.service.js');

    await expect(
      processTrengoWebhook({
        data: {
          id: 'msg_1',
          conversation_id: 'ticket_42',
          contact: { phone: '+15555550123' },
          message: { body: 'reply text' },
        },
      } as never),
    ).resolves.toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'trengo:msg_1',
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
