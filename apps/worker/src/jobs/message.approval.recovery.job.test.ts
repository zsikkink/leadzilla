import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock } = vi.hoisted(() => {
  class PrismaClientKnownRequestError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }

  return {
    dbMock: {
      Prisma: {
        PrismaClientKnownRequestError,
      },
      prisma: {
        messageDraft: {
          findMany: vi.fn(),
        },
        messageSend: {
          findFirst: vi.fn(),
          findUnique: vi.fn(),
          create: vi.fn(),
        },
      },
    },
  };
});

vi.mock('@lead-flood/db', () => ({
  Prisma: dbMock.Prisma,
  PrismaRuntime: dbMock.Prisma,
  prisma: dbMock.prisma,
}));

import {
  recoverApprovedInitialDraftsMissingMessageSends,
} from './message.approval.recovery.job.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('recoverApprovedInitialDraftsMissingMessageSends', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T14:30:00.000Z'));
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips approval send recovery while outbound sending is disabled', async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await expect(
      recoverApprovedInitialDraftsMissingMessageSends(logger, { boss }),
    ).resolves.toBe(0);

    expect(dbMock.prisma.messageDraft.findMany).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.findFirst).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.findUnique).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      {},
      'Skipping manual approval MessageSend recovery because outbound sending is disabled for the Leadzilla demo',
    );
  });
});
