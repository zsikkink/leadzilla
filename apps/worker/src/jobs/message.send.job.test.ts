import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, pipelineSettingsMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      messageSend: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      feedbackEvent: {
        findFirst: vi.fn(),
      },
      lead: {
        updateMany: vi.fn(),
      },
    },
  },
  pipelineSettingsMock: {
    getEmailDailyLimit: vi.fn(),
    getWhatsappDailyLimit: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getEmailDailyLimit: pipelineSettingsMock.getEmailDailyLimit,
  getWhatsappDailyLimit: pipelineSettingsMock.getWhatsappDailyLimit,
}));

import {
  handleMessageSendJob,
  type MessageSendJobDependencies,
  type MessageSendJobPayload,
} from './message.send.job.js';

function makeJob(data: MessageSendJobPayload): Job<MessageSendJobPayload> {
  return {
    id: randomUUID(),
    name: 'message.send',
    data,
  } as Job<MessageSendJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makeDeps(sendEmail: () => Promise<{
  status: 'success';
  providerMessageId: string;
} | {
  status: 'terminal_error';
  failure: {
    classification: 'terminal';
    statusCode: number;
    message: string;
    raw: null;
  };
}>): MessageSendJobDependencies {
  return {
    resendAdapter: {
      isConfigured: true,
      sendEmail: vi.fn(sendEmail),
    } as unknown as MessageSendJobDependencies['resendAdapter'],
    trengoAdapter: {
      isConfigured: true,
      sendMessage: vi.fn(),
      sendTemplateMessage: vi.fn(),
    } as unknown as MessageSendJobDependencies['trengoAdapter'],
  };
}

describe('handleMessageSendJob stale retry safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.messageSend.findUnique.mockResolvedValue({
      id: 'send_1',
      leadId: 'lead_1',
      status: 'QUEUED',
      channel: 'EMAIL',
      followUpNumber: 2,
      idempotencyKey: 'idem_1',
      messageVariant: {
        variantKey: 'variant_a',
        subject: 'Hello',
        bodyText: 'Body copy',
        bodyHtml: null,
      },
      lead: {
        id: 'lead_1',
        email: 'ada@example.com',
        phone: null,
        firstName: 'Ada',
        lastName: 'Lovelace',
        deletedAt: null,
      },
    });
    dbMock.prisma.feedbackEvent.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.updateMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.lead.updateMany.mockResolvedValue({ count: 1 });
  });

  it('skips stale success writes when the send row advanced after the initial fetch', async () => {
    const sendEmail = vi.fn(async () => ({
      status: 'success' as const,
      providerMessageId: 'provider_msg_1',
    }));
    const deps = {
      resendAdapter: {
        isConfigured: true,
        sendEmail,
      } as unknown as MessageSendJobDependencies['resendAdapter'],
      trengoAdapter: {
        isConfigured: true,
        sendMessage: vi.fn(),
        sendTemplateMessage: vi.fn(),
      } as unknown as MessageSendJobDependencies['trengoAdapter'],
    };

    dbMock.prisma.messageSend.updateMany.mockResolvedValueOnce({ count: 0 });

    await handleMessageSendJob(
      logger,
      makeJob({
        runId: 'run_1',
        sendId: 'send_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'idem_1',
        channel: 'EMAIL',
      }),
      deps,
    );

    expect(sendEmail).toHaveBeenCalledWith({
      to: 'ada@example.com',
      subject: 'Hello',
      bodyText: 'Body copy',
      bodyHtml: null,
      idempotencyKey: 'idem_1',
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_1',
        status: 'QUEUED',
      },
      data: expect.objectContaining({
        status: 'SENT',
        providerMessageId: 'provider_msg_1',
        followUpNumber: 2,
      }),
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1' }),
      'MessageSend state advanced before success write; skipping stale send update',
    );
    expect(dbMock.prisma.lead.updateMany).not.toHaveBeenCalled();
  });

  it('reconciles email success metadata when a delivered webhook wins the race', async () => {
    dbMock.prisma.messageSend.findUnique
      .mockResolvedValueOnce({
        id: 'send_1',
        leadId: 'lead_1',
        status: 'QUEUED',
        channel: 'EMAIL',
        followUpNumber: 0,
        idempotencyKey: 'idem_1',
        messageVariant: {
          variantKey: 'variant_a',
          subject: 'Hello',
          bodyText: 'Body copy',
          bodyHtml: null,
        },
        lead: {
          id: 'lead_1',
          email: 'ada@example.com',
          phone: null,
          firstName: 'Ada',
          lastName: 'Lovelace',
          deletedAt: null,
        },
      })
      .mockResolvedValueOnce({
        status: 'DELIVERED',
        providerMessageId: null,
        providerConversationId: null,
        sentAt: null,
        nextFollowUpAfter: null,
      });

    const sendEmail = vi.fn(async () => ({
      status: 'success' as const,
      providerMessageId: 'provider_msg_1',
    }));

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await handleMessageSendJob(
      logger,
      makeJob({
        runId: 'run_1',
        sendId: 'send_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'idem_1',
        channel: 'EMAIL',
      }),
      makeDeps(sendEmail),
    );

    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'DELIVERED',
      },
      data: expect.objectContaining({
        providerMessageId: 'provider_msg_1',
        sentAt: expect.any(Date),
        nextFollowUpAfter: expect.any(Date),
      }),
    });
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        status: { in: ['qualified', 'drafted'] },
      },
      data: {
        status: 'messaged',
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1', status: 'DELIVERED' }),
      'MessageSend success metadata reconciled after external status advance',
    );
  });

  it('uses the persisted send row when attempting delivery', async () => {
    const sendEmail = vi.fn(async () => ({
      status: 'success' as const,
      providerMessageId: 'provider_msg_1',
    }));

    const deps = {
      resendAdapter: {
        isConfigured: true,
        sendEmail,
      } as unknown as MessageSendJobDependencies['resendAdapter'],
      trengoAdapter: {
        isConfigured: true,
        sendMessage: vi.fn(),
        sendTemplateMessage: vi.fn(),
      } as unknown as MessageSendJobDependencies['trengoAdapter'],
    };

    dbMock.prisma.messageSend.updateMany.mockResolvedValueOnce({ count: 0 });

    await handleMessageSendJob(
      logger,
      makeJob({
        runId: 'run_1',
        sendId: 'send_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'idem_1',
        channel: 'EMAIL',
      }),
      deps,
    );

    expect(sendEmail).toHaveBeenCalledWith({
      to: 'ada@example.com',
      subject: 'Hello',
      bodyText: 'Body copy',
      bodyHtml: null,
      idempotencyKey: 'idem_1',
    });
  });

  it('reconciles WhatsApp success metadata when a reply webhook wins the race', async () => {
    dbMock.prisma.messageSend.findUnique
      .mockResolvedValueOnce({
        id: 'send_1',
        leadId: 'lead_1',
        status: 'QUEUED',
        channel: 'WHATSAPP',
        followUpNumber: 0,
        idempotencyKey: 'idem_1',
        messageVariant: {
          variantKey: 'variant_a',
          subject: null,
          bodyText: 'Body copy',
          bodyHtml: null,
        },
        lead: {
          id: 'lead_1',
          email: 'ada@example.com',
          phone: '+15555550123',
          firstName: 'Ada',
          lastName: 'Lovelace',
          deletedAt: null,
        },
      })
      .mockResolvedValueOnce({
        status: 'REPLIED',
        providerMessageId: null,
        providerConversationId: null,
        sentAt: null,
        nextFollowUpAfter: null,
      });

    dbMock.prisma.messageSend.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    const deps = {
      resendAdapter: {
        isConfigured: true,
        sendEmail: vi.fn(),
      } as unknown as MessageSendJobDependencies['resendAdapter'],
      trengoAdapter: {
        isConfigured: true,
        sendMessage: vi.fn(async () => ({
          status: 'success' as const,
          providerMessageId: 'provider_msg_wa_1',
        })),
        sendTemplateMessage: vi.fn(async () => ({
          status: 'success' as const,
          providerMessageId: 'provider_msg_wa_1',
          ticketId: 'ticket_42',
        })),
      } as unknown as MessageSendJobDependencies['trengoAdapter'],
    };

    await handleMessageSendJob(
      logger,
      makeJob({
        runId: 'run_1',
        sendId: 'send_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'idem_1',
        channel: 'WHATSAPP',
      }),
      deps,
    );

    expect(deps.trengoAdapter.sendTemplateMessage).toHaveBeenCalledWith({
      recipientPhoneNumber: '+15555550123',
      params: ['Ada', 'Body copy'],
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'REPLIED',
      },
      data: {
        providerMessageId: 'provider_msg_wa_1',
        providerConversationId: 'ticket_42',
        sentAt: expect.any(Date),
      },
    });
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        status: { in: ['qualified', 'drafted'] },
      },
      data: {
        status: 'messaged',
      },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1', status: 'REPLIED' }),
      'MessageSend success metadata reconciled after external status advance',
    );
  });

  it('skips stale failure writes when the send row advanced after the initial fetch', async () => {
    const sendEmail = async () => ({
      status: 'terminal_error' as const,
      failure: {
        classification: 'terminal' as const,
        statusCode: 400,
        message: 'bad request',
        raw: null,
      },
    });

    dbMock.prisma.messageSend.updateMany.mockResolvedValueOnce({ count: 0 });

    await handleMessageSendJob(
      logger,
      makeJob({
        runId: 'run_1',
        sendId: 'send_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_1',
        idempotencyKey: 'idem_1',
        channel: 'EMAIL',
      }),
      makeDeps(sendEmail),
    );

    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_1',
        status: 'QUEUED',
      },
      data: {
        status: 'FAILED',
        failureCode: '400',
        failureReason: 'bad request',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1' }),
      'MessageSend state advanced before failure write; skipping stale failure update',
    );
  });
});
