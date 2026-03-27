import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      messageSend: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

import {
  handleMessageSendRecoveryJob,
  STALE_QUEUED_MESSAGE_SEND_THRESHOLD_MS,
  type MessageSendRecoveryJobPayload,
} from './message.send.recovery.job.js';

function makeJob(data: MessageSendRecoveryJobPayload): Job<MessageSendRecoveryJobPayload> {
  return {
    id: randomUUID(),
    name: 'message.send.recovery',
    data,
  } as Job<MessageSendRecoveryJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleMessageSendRecoveryJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T14:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries only aged QUEUED sends and republishes them immediately', async () => {
    dbMock.prisma.messageSend.findMany
      .mockResolvedValueOnce([
        {
          id: 'send_initial',
          messageDraftId: 'draft_initial',
          messageVariantId: 'variant_initial',
          idempotencyKey: 'idem_initial',
          channel: 'EMAIL',
          scheduledAt: null,
        },
        {
          id: 'send_approval',
          messageDraftId: 'draft_approval',
          messageVariantId: 'variant_approval',
          idempotencyKey: 'idem_approval',
          channel: 'WHATSAPP',
          scheduledAt: new Date('2026-03-22T14:25:00.000Z'),
        },
        {
          id: 'send_auto',
          messageDraftId: 'draft_auto',
          messageVariantId: 'variant_auto',
          idempotencyKey: 'idem_auto',
          channel: 'EMAIL',
          scheduledAt: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleMessageSendRecoveryJob(
      logger,
      makeJob({
        correlationId: 'corr_1',
      }),
      { boss },
    );

    expect(dbMock.prisma.messageSend.findMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: 'QUEUED',
        updatedAt: {
          lt: new Date(Date.now() - STALE_QUEUED_MESSAGE_SEND_THRESHOLD_MS),
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        messageDraftId: true,
        messageVariantId: true,
        idempotencyKey: true,
        channel: true,
        scheduledAt: true,
      },
    });
    expect(dbMock.prisma.messageSend.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'SENDING',
        updatedAt: {
          lt: new Date(Date.now() - STALE_QUEUED_MESSAGE_SEND_THRESHOLD_MS),
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        updatedAt: true,
      },
    });

    expect(boss.send).toHaveBeenCalledTimes(3);
    expect(dbMock.prisma.messageSend.updateMany).not.toHaveBeenCalled();
    expect(boss.send).toHaveBeenNthCalledWith(
      1,
      'message.send',
      {
        runId: 'message.send:send_initial',
        sendId: 'send_initial',
        messageDraftId: 'draft_initial',
        messageVariantId: 'variant_initial',
        idempotencyKey: 'idem_initial',
        channel: 'EMAIL',
      },
      {
        singletonKey: 'message.send:send_initial',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
      },
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      2,
      'message.send',
      {
        runId: 'message.send:send_approval',
        sendId: 'send_approval',
        messageDraftId: 'draft_approval',
        messageVariantId: 'variant_approval',
        idempotencyKey: 'idem_approval',
        channel: 'WHATSAPP',
        scheduledAt: '2026-03-22T14:25:00.000Z',
      },
      {
        singletonKey: 'message.send:send_approval',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
      },
    );
    expect(boss.send).toHaveBeenNthCalledWith(
      3,
      'message.send',
      {
        runId: 'message.send:send_auto',
        sendId: 'send_auto',
        messageDraftId: 'draft_auto',
        messageVariantId: 'variant_auto',
        idempotencyKey: 'idem_auto',
        channel: 'EMAIL',
      },
      {
        singletonKey: 'message.send:send_auto',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
      },
    );
  });

  it('preserves future scheduled sends with startAfter', async () => {
    dbMock.prisma.messageSend.findMany
      .mockResolvedValueOnce([
        {
          id: 'send_scheduled',
          messageDraftId: 'draft_scheduled',
          messageVariantId: 'variant_scheduled',
          idempotencyKey: 'idem_scheduled',
          channel: 'EMAIL',
          scheduledAt: new Date('2026-03-22T15:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([]);

    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleMessageSendRecoveryJob(
      logger,
      makeJob({
        correlationId: 'corr_2',
      }),
      { boss },
    );

    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      {
        runId: 'message.send:send_scheduled',
        sendId: 'send_scheduled',
        messageDraftId: 'draft_scheduled',
        messageVariantId: 'variant_scheduled',
        idempotencyKey: 'idem_scheduled',
        channel: 'EMAIL',
        scheduledAt: '2026-03-22T15:00:00.000Z',
      },
      {
        singletonKey: 'message.send:send_scheduled',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
        startAfter: new Date('2026-03-22T15:00:00.000Z'),
      },
    );
    expect(dbMock.prisma.messageSend.updateMany).not.toHaveBeenCalled();
  });

  it('quarantines aged SENDING sends without replaying them', async () => {
    dbMock.prisma.messageSend.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'send_stale',
          updatedAt: new Date('2026-03-22T14:00:00.000Z'),
        },
        {
          id: 'send_advanced',
          updatedAt: new Date('2026-03-22T14:05:00.000Z'),
        },
      ]);
    dbMock.prisma.messageSend.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleMessageSendRecoveryJob(
      logger,
      makeJob({
        correlationId: 'corr_3',
      }),
      { boss },
    );

    expect(boss.send).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'send_stale',
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
      },
    });
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'send_advanced',
        status: 'SENDING',
      },
      data: {
        status: 'UNRESOLVED',
      },
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        sendId: 'send_stale',
        sendingSince: '2026-03-22T14:00:00.000Z',
      }),
      'Quarantined stale sending MessageSend',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        sendId: 'send_advanced',
        sendingSince: '2026-03-22T14:05:00.000Z',
      }),
      'Skipped stale sending MessageSend quarantine because status advanced',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveredCount: 0,
        quarantinedCount: 1,
      }),
      'Completed message.send recovery job',
    );
  });
});
