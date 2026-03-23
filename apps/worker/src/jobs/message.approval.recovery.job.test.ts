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
  prisma: dbMock.prisma,
}));

import {
  recoverApprovedInitialDraftsMissingMessageSends,
  STALE_APPROVED_DRAFT_THRESHOLD_MS,
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

  it('queries only aged manually approved initial drafts with variants and no initial send', async () => {
    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await recoverApprovedInitialDraftsMissingMessageSends(logger, { boss });

    expect(dbMock.prisma.messageDraft.findMany).toHaveBeenCalledWith({
      where: {
        followUpNumber: 0,
        approvalStatus: 'APPROVED',
        approvedAt: {
          lt: new Date(Date.now() - STALE_APPROVED_DRAFT_THRESHOLD_MS),
        },
        variants: { some: {} },
        messageSends: {
          none: {
            followUpNumber: 0,
          },
        },
      },
      orderBy: [{ approvedAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        leadId: true,
        approvedAt: true,
        variants: {
          orderBy: [{ variantKey: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            channel: true,
            isSelected: true,
          },
        },
      },
    });
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('creates and enqueues a missing initial send with the canonical approval idempotency key', async () => {
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([
      {
        id: 'draft_1',
        leadId: 'lead_1',
        approvedAt: new Date('2026-03-22T14:00:00.000Z'),
        variants: [
          { id: 'variant_a', channel: 'EMAIL', isSelected: false },
          { id: 'variant_b', channel: 'WHATSAPP', isSelected: true },
        ],
      },
    ]);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.create.mockResolvedValue({
      id: 'send_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_b',
      idempotencyKey: 'approve:draft_1:variant_b',
      channel: 'WHATSAPP',
      scheduledAt: null,
      status: 'QUEUED',
    });

    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await expect(
      recoverApprovedInitialDraftsMissingMessageSends(logger, { boss }),
    ).resolves.toBe(1);

    expect(dbMock.prisma.messageSend.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_b',
        channel: 'WHATSAPP',
        provider: 'TRENGO',
        status: 'QUEUED',
        idempotencyKey: 'approve:draft_1:variant_b',
        followUpNumber: 0,
      },
      select: {
        id: true,
        messageDraftId: true,
        messageVariantId: true,
        idempotencyKey: true,
        channel: true,
        scheduledAt: true,
        status: true,
      },
    });
    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      {
        runId: 'message.send:send_1',
        sendId: 'send_1',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_b',
        idempotencyKey: 'approve:draft_1:variant_b',
        channel: 'WHATSAPP',
      },
      {
        singletonKey: 'message.send:send_1',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
      },
    );
  });

  it('falls back to the first ordered variant when no selected variant is persisted', async () => {
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([
      {
        id: 'draft_1',
        leadId: 'lead_1',
        approvedAt: new Date('2026-03-22T14:00:00.000Z'),
        variants: [
          { id: 'variant_a', channel: 'EMAIL', isSelected: false },
          { id: 'variant_b', channel: 'EMAIL', isSelected: false },
        ],
      },
    ]);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.create.mockResolvedValue({
      id: 'send_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_a',
      idempotencyKey: 'approve:draft_1:variant_a',
      channel: 'EMAIL',
      scheduledAt: null,
      status: 'QUEUED',
    });

    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await recoverApprovedInitialDraftsMissingMessageSends(logger, { boss });

    expect(dbMock.prisma.messageSend.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageVariantId: 'variant_a',
          idempotencyKey: 'approve:draft_1:variant_a',
          provider: 'RESEND',
        }),
      }),
    );
  });

  it('skips creation when an initial send already exists and re-enqueues the queued row', async () => {
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([
      {
        id: 'draft_1',
        leadId: 'lead_1',
        approvedAt: new Date('2026-03-22T14:00:00.000Z'),
        variants: [
          { id: 'variant_a', channel: 'EMAIL', isSelected: true },
        ],
      },
    ]);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue({
      id: 'send_existing',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_a',
      idempotencyKey: 'approve:draft_1:variant_a',
      channel: 'EMAIL',
      scheduledAt: null,
      status: 'QUEUED',
    });

    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await expect(
      recoverApprovedInitialDraftsMissingMessageSends(logger, { boss }),
    ).resolves.toBe(0);

    expect(dbMock.prisma.messageSend.create).not.toHaveBeenCalled();
    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      {
        runId: 'message.send:send_existing',
        sendId: 'send_existing',
        messageDraftId: 'draft_1',
        messageVariantId: 'variant_a',
        idempotencyKey: 'approve:draft_1:variant_a',
        channel: 'EMAIL',
      },
      {
        singletonKey: 'message.send:send_existing',
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
      },
    );
  });

  it('treats canonical idempotency key races as benign and does not throw', async () => {
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([
      {
        id: 'draft_1',
        leadId: 'lead_1',
        approvedAt: new Date('2026-03-22T14:00:00.000Z'),
        variants: [
          { id: 'variant_a', channel: 'EMAIL', isSelected: true },
        ],
      },
    ]);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.create.mockRejectedValue(
      new dbMock.Prisma.PrismaClientKnownRequestError('P2002'),
    );
    dbMock.prisma.messageSend.findUnique.mockResolvedValue({
      id: 'send_existing',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_a',
      idempotencyKey: 'approve:draft_1:variant_a',
      channel: 'EMAIL',
      scheduledAt: null,
      status: 'QUEUED',
    });

    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await expect(
      recoverApprovedInitialDraftsMissingMessageSends(logger, { boss }),
    ).resolves.toBe(0);

    expect(dbMock.prisma.messageSend.create).toHaveBeenCalledTimes(1);
    expect(dbMock.prisma.messageSend.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: 'approve:draft_1:variant_a' },
      select: {
        id: true,
        messageDraftId: true,
        messageVariantId: true,
        idempotencyKey: true,
        channel: true,
        scheduledAt: true,
        status: true,
      },
    });
    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      expect.objectContaining({
        sendId: 'send_existing',
        idempotencyKey: 'approve:draft_1:variant_a',
      }),
      expect.objectContaining({
        singletonKey: 'message.send:send_existing',
      }),
    );
  });

  it('logs enqueue failures after creating the send row and relies on queued-send recovery afterward', async () => {
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([
      {
        id: 'draft_1',
        leadId: 'lead_1',
        approvedAt: new Date('2026-03-22T14:00:00.000Z'),
        variants: [
          { id: 'variant_a', channel: 'EMAIL', isSelected: true },
        ],
      },
    ]);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.create.mockResolvedValue({
      id: 'send_1',
      messageDraftId: 'draft_1',
      messageVariantId: 'variant_a',
      idempotencyKey: 'approve:draft_1:variant_a',
      channel: 'EMAIL',
      scheduledAt: null,
      status: 'QUEUED',
    });

    const boss = { send: vi.fn().mockRejectedValue(new Error('pg-boss unavailable')) };

    await expect(
      recoverApprovedInitialDraftsMissingMessageSends(logger, { boss }),
    ).resolves.toBe(1);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        draftId: 'draft_1',
        sendId: 'send_1',
      }),
      'Failed to enqueue recovered initial MessageSend after manual approval recovery',
    );
  });
});
