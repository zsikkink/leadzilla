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

  it('skips queued send replay while outbound sending is disabled', async () => {
    dbMock.prisma.messageSend.findMany.mockResolvedValueOnce([]);

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

    expect(boss.send).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.updateMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      {},
      'Skipping stale queued MessageSend recovery because outbound sending is disabled for the Leadzilla demo',
    );
  });

  it('does not replay future scheduled sends while outbound sending is disabled', async () => {
    dbMock.prisma.messageSend.findMany.mockResolvedValueOnce([]);

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

    expect(boss.send).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.updateMany).not.toHaveBeenCalled();
  });

  it('quarantines aged SENDING sends without replaying them', async () => {
    dbMock.prisma.messageSend.findMany
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
