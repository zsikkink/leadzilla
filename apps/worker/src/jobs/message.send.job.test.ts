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
        findMany: vi.fn(),
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
import { RetryableError } from '../errors.js';

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
  status: 'retryable_error';
  failure: {
    classification: 'retryable';
    statusCode: number;
    message: string;
    raw: null;
  };
} | {
  status: 'indeterminate_error';
  failure: {
    classification: 'indeterminate';
    statusCode: number | null;
    message: string;
    raw: null;
  };
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
    dbMock.prisma.feedbackEvent.findMany.mockResolvedValue([]);
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

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

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
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'send_1',
        status: 'QUEUED',
      },
      data: {
        status: 'SENDING',
      },
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'SENDING',
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
      .mockResolvedValueOnce({ count: 1 })
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
        status: 'SENDING',
      },
      data: expect.objectContaining({
        status: 'SENT',
        providerMessageId: 'provider_msg_1',
        sentAt: expect.any(Date),
        nextFollowUpAfter: expect.any(Date),
      }),
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(3, {
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
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'send_1',
        status: 'QUEUED',
      },
      data: {
        status: 'SENDING',
      },
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'SENDING',
      },
      data: expect.objectContaining({
        status: 'SENT',
        providerMessageId: 'provider_msg_1',
      }),
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
      .mockResolvedValueOnce({ count: 1 })
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
        status: 'SENDING',
      },
      data: {
        status: 'SENT',
        providerMessageId: 'provider_msg_wa_1',
        providerConversationId: 'ticket_42',
        sentAt: expect.any(Date),
        followUpNumber: 0,
        nextFollowUpAfter: expect.any(Date),
      },
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(3, {
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

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

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
        status: 'SENDING',
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

  it('no-ops without calling the provider when a retry sees SENDING', async () => {
    dbMock.prisma.messageSend.findUnique.mockResolvedValueOnce({
      id: 'send_1',
      leadId: 'lead_1',
      status: 'SENDING',
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
    });

    const sendEmail = vi.fn(async () => ({
      status: 'success' as const,
      providerMessageId: 'provider_msg_1',
    }));

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

    expect(sendEmail).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.updateMany).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1', status: 'SENDING' }),
      'MessageSend already claimed for provider send',
    );
  });

  it('no-ops without calling the provider when a retry sees UNRESOLVED', async () => {
    dbMock.prisma.messageSend.findUnique.mockResolvedValueOnce({
      id: 'send_1',
      leadId: 'lead_1',
      status: 'UNRESOLVED',
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
    });

    const sendEmail = vi.fn(async () => ({
      status: 'success' as const,
      providerMessageId: 'provider_msg_1',
    }));

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

    expect(sendEmail).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.updateMany).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1', status: 'UNRESOLVED' }),
      'MessageSend is quarantined as unresolved and will not be replayed automatically',
    );
  });

  it('re-queues email sends and throws for safe retryable provider rejections after claim', async () => {
    const sendEmail = vi.fn(async () => ({
      status: 'retryable_error' as const,
      failure: {
        classification: 'retryable' as const,
        statusCode: 429,
        message: 'rate limited',
        raw: null,
      },
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

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(handleMessageSendJob(
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
    )).rejects.toBeInstanceOf(RetryableError);

    expect(sendEmail).toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenCalledTimes(2);
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'send_1',
        status: 'QUEUED',
      },
      data: {
        status: 'SENDING',
      },
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'SENDING',
      },
      data: {
        status: 'QUEUED',
        failureCode: null,
        failureReason: null,
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1' }),
      'Email send returned safe retryable error after claim; resetting send to QUEUED for automatic retry',
    );
  });

  it('moves indeterminate email outcomes to UNRESOLVED immediately after claim', async () => {
    const sendEmail = vi.fn(async () => ({
      status: 'indeterminate_error' as const,
      failure: {
        classification: 'indeterminate' as const,
        statusCode: null,
        message: 'ECONNRESET',
        raw: null,
      },
    }));

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
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
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
        failureCode: 'POST_CLAIM_INDETERMINATE',
        failureReason: 'Email send outcome is indeterminate after provider request: ECONNRESET',
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1' }),
      'Email send outcome is indeterminate after claim; quarantined for manual resolution',
    );
  });

  it('re-queues WhatsApp sends and throws for safe retryable provider rejections after claim', async () => {
    dbMock.prisma.messageSend.findUnique.mockResolvedValueOnce({
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
    });

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const deps = {
      resendAdapter: {
        isConfigured: true,
        sendEmail: vi.fn(),
      } as unknown as MessageSendJobDependencies['resendAdapter'],
      trengoAdapter: {
        isConfigured: true,
        sendMessage: vi.fn(),
        sendTemplateMessage: vi.fn(async () => ({
          status: 'retryable_error' as const,
          failure: {
            classification: 'retryable' as const,
            statusCode: 429,
            message: 'rate limited',
            raw: null,
          },
        })),
      } as unknown as MessageSendJobDependencies['trengoAdapter'],
    };

    await expect(handleMessageSendJob(
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
    )).rejects.toBeInstanceOf(RetryableError);

    expect(deps.trengoAdapter.sendTemplateMessage).toHaveBeenCalledWith({
      recipientPhoneNumber: '+15555550123',
      params: ['Ada', 'Body copy'],
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'SENDING',
      },
      data: {
        status: 'QUEUED',
        failureCode: null,
        failureReason: null,
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1' }),
      'WhatsApp send returned safe retryable error after claim; resetting send to QUEUED for automatic retry',
    );
  });

  it('moves indeterminate WhatsApp outcomes to UNRESOLVED immediately after claim', async () => {
    dbMock.prisma.messageSend.findUnique.mockResolvedValueOnce({
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
    });

    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });

    const deps = {
      resendAdapter: {
        isConfigured: true,
        sendEmail: vi.fn(),
      } as unknown as MessageSendJobDependencies['resendAdapter'],
      trengoAdapter: {
        isConfigured: true,
        sendMessage: vi.fn(),
        sendTemplateMessage: vi.fn(async () => ({
          status: 'indeterminate_error' as const,
          failure: {
            classification: 'indeterminate' as const,
            statusCode: 500,
            message: 'Trengo API returned status 500',
            raw: null,
          },
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

    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_1',
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
        failureCode: 'POST_CLAIM_INDETERMINATE',
        failureReason: 'WhatsApp send outcome is indeterminate after provider request: Trengo API returned status 500',
      },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sendId: 'send_1' }),
      'WhatsApp send outcome is indeterminate after claim; quarantined for manual resolution',
    );
  });
});
