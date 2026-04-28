import type PgBoss from 'pg-boss';
import { prisma } from '@lead-flood/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchPendingOutboxEvents } from './outbox-dispatcher.js';

describe('dispatchPendingOutboxEvents', () => {
  const createdOutboxIds: string[] = [];
  const createdJobIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdIcpProfileIds: string[] = [];

  async function createQueuedJobFixture() {
    const lead = await prisma.lead.create({
      data: {
        firstName: 'Worker',
        lastName: 'Test',
        email: `worker-outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@lead-flood.local`,
        source: 'test',
        status: 'new',
      },
    });
    createdLeadIds.push(lead.id);

    const jobExecution = await prisma.jobExecution.create({
      data: {
        type: 'lead.enrich.stub',
        status: 'queued',
        payload: {
          leadId: lead.id,
          source: 'test',
        },
        leadId: lead.id,
      },
    });
    createdJobIds.push(jobExecution.id);

    return {
      leadId: lead.id,
      jobExecutionId: jobExecution.id,
    };
  }

  async function createDiscoverySeedDispatchFixture() {
    const discoveryRun = await prisma.jobExecution.create({
      data: {
        type: 'discovery.run',
        status: 'running',
        payload: {
          icpProfileId: 'icp_1',
          countries: ['AE'],
        },
      },
    });
    const seedJob = await prisma.jobExecution.create({
      data: {
        type: 'discovery.seed',
        status: 'queued',
        payload: {
          discoveryRunId: discoveryRun.id,
          icpProfileId: 'icp_1',
          countries: ['AE'],
        },
      },
    });

    createdJobIds.push(discoveryRun.id, seedJob.id);

    return {
      discoveryRunId: discoveryRun.id,
      seedJobExecutionId: seedJob.id,
    };
  }

  async function createMessageSendDispatchFixture(input?: {
    channel?: 'EMAIL' | 'WHATSAPP';
    scheduledAt?: Date | null;
    sendStatus?: 'QUEUED' | 'SENDING' | 'UNRESOLVED' | 'SENT' | 'DELIVERED' | 'REPLIED' | 'BOUNCED' | 'FAILED';
  }) {
    const channel = input?.channel ?? 'EMAIL';

    const lead = await prisma.lead.create({
      data: {
        firstName: 'Worker',
        lastName: 'Dispatch',
        email: `worker-message-send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@lead-flood.local`,
        source: 'test',
        status: 'new',
      },
    });
    createdLeadIds.push(lead.id);

    const icpProfile = await prisma.icpProfile.create({
      data: {
        name: `Worker Message Send ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      },
    });
    createdIcpProfileIds.push(icpProfile.id);

    const draft = await prisma.messageDraft.create({
      data: {
        leadId: lead.id,
        icpProfileId: icpProfile.id,
        promptVersion: 'test',
        generatedByModel: 'test',
        approvalStatus: 'APPROVED',
        approvedByUserId: 'user_worker',
        approvedAt: new Date(),
        variants: {
          create: {
            variantKey: 'variant_a',
            channel,
            subject: channel === 'EMAIL' ? 'Subject' : null,
            bodyText: 'Hello from outbox dispatcher test',
            isSelected: true,
          },
        },
      },
      include: {
        variants: {
          take: 1,
        },
      },
    });

    const variant = draft.variants[0];
    if (!variant) {
      throw new Error('Expected message draft variant fixture');
    }

    const idempotencyKey = `outbox-message-send:${draft.id}:${variant.id}:${Math.random().toString(36).slice(2, 8)}`;
    const send = await prisma.messageSend.create({
      data: {
        leadId: lead.id,
        messageDraftId: draft.id,
        messageVariantId: variant.id,
        channel,
        provider: channel === 'WHATSAPP' ? 'TRENGO' : 'RESEND',
        status: input?.sendStatus ?? 'QUEUED',
        idempotencyKey,
        followUpNumber: 0,
        scheduledAt: input?.scheduledAt ?? null,
      },
    });

    return {
      sendId: send.id,
      messageDraftId: draft.id,
      messageVariantId: variant.id,
      idempotencyKey,
      channel,
    };
  }

  async function createFeaturesComputeDispatchFixture() {
    const lead = await prisma.lead.create({
      data: {
        firstName: 'Feature',
        lastName: 'Dispatch',
        email: `features-outbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@lead-flood.local`,
        source: 'test',
        status: 'new',
      },
    });
    createdLeadIds.push(lead.id);

    const jobExecution = await prisma.jobExecution.create({
      data: {
        type: 'features.compute',
        status: 'queued',
        payload: {
          leadId: lead.id,
          icpProfileId: 'icp_1',
          snapshotVersion: 1,
        },
        leadId: lead.id,
      },
    });
    createdJobIds.push(jobExecution.id);

    return {
      leadId: lead.id,
      jobExecutionId: jobExecution.id,
      icpProfileId: 'icp_1',
    };
  }

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany({
      where: {
        status: {
          in: ['pending', 'failed', 'processing'],
        },
      },
    });
  });

  afterEach(async () => {
    if (createdOutboxIds.length > 0) {
      await prisma.outboxEvent.deleteMany({
        where: {
          id: {
            in: createdOutboxIds.splice(0, createdOutboxIds.length),
          },
        },
      });
    }

    if (createdJobIds.length > 0) {
      await prisma.jobExecution.deleteMany({
        where: {
          id: {
            in: createdJobIds.splice(0, createdJobIds.length),
          },
        },
      });
    }

    if (createdLeadIds.length > 0) {
      await prisma.lead.deleteMany({
        where: {
          id: {
            in: createdLeadIds.splice(0, createdLeadIds.length),
          },
        },
      });
    }

    if (createdIcpProfileIds.length > 0) {
      await prisma.icpProfile.deleteMany({
        where: {
          id: {
            in: createdIcpProfileIds.splice(0, createdIcpProfileIds.length),
          },
        },
      });
    }
  });

  it('marks pending outbox events as sent when publish succeeds', async () => {
    const fixture = await createQueuedJobFixture();
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'lead.enrich.stub',
        payload: {
          leadId: fixture.leadId,
          jobExecutionId: fixture.jobExecutionId,
          source: 'test',
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(async () => 'ok'),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(1);
    expect(boss.send).toHaveBeenCalledTimes(1);

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('sent');
    expect(updated?.attempts).toBe(1);
    expect(updated?.processedAt).not.toBeNull();
  });

  it('dispatches discovery.seed outbox rows using the per-seed job execution gate', async () => {
    const fixture = await createDiscoverySeedDispatchFixture();
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'discovery.seed',
        payload: {
          reason: 'api',
          correlationId: fixture.discoveryRunId,
          discoveryRunId: fixture.discoveryRunId,
          jobExecutionId: fixture.seedJobExecutionId,
          icpProfileId: 'icp_1',
          countries: ['AE'],
          enqueueRunTasks: true,
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(async () => 'ok'),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(1);
    expect(boss.send).toHaveBeenCalledWith(
      'discovery.seed',
      expect.objectContaining({
        discoveryRunId: fixture.discoveryRunId,
        jobExecutionId: fixture.seedJobExecutionId,
        icpProfileId: 'icp_1',
      }),
      expect.objectContaining({
        singletonKey: `discovery.seed:${fixture.discoveryRunId}:icp_1`,
      }),
    );

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('sent');
    expect(updated?.attempts).toBe(1);
  });

  it('dispatches pending message.send outbox rows using the queued MessageSend gate', async () => {
    const fixture = await createMessageSendDispatchFixture();
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'message.send',
        payload: {
          runId: `message.send:${fixture.sendId}`,
          sendId: fixture.sendId,
          messageDraftId: fixture.messageDraftId,
          messageVariantId: fixture.messageVariantId,
          idempotencyKey: fixture.idempotencyKey,
          channel: fixture.channel,
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(
        async (_name: string, _payload?: unknown, _options?: Record<string, unknown>) => 'ok',
      ),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(1);
    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      expect.objectContaining({
        runId: `message.send:${fixture.sendId}`,
        sendId: fixture.sendId,
        messageDraftId: fixture.messageDraftId,
        messageVariantId: fixture.messageVariantId,
      }),
      expect.objectContaining({
        singletonKey: `message.send:${fixture.sendId}`,
        retryLimit: 5,
        retryDelay: 90,
        retryBackoff: true,
        deadLetter: 'message.send.dead_letter',
      }),
    );

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('sent');
    expect(updated?.attempts).toBe(1);
    expect(updated?.processedAt).not.toBeNull();
  });

  it('marks tracked features.compute runs running after publish and suppresses replay once already running', async () => {
    const fixture = await createFeaturesComputeDispatchFixture();
    const firstEvent = await prisma.outboxEvent.create({
      data: {
        type: 'features.compute',
        payload: {
          runId: fixture.jobExecutionId,
          leadId: fixture.leadId,
          icpProfileId: fixture.icpProfileId,
          snapshotVersion: 1,
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(firstEvent.id);

    const boss = {
      send: vi.fn(async () => 'ok'),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const firstCount = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(firstCount).toBe(1);
    expect(boss.send).toHaveBeenCalledTimes(1);

    const publishedJob = await prisma.jobExecution.findUnique({
      where: { id: fixture.jobExecutionId },
    });
    expect(publishedJob?.status).toBe('running');
    expect(publishedJob?.startedAt).not.toBeNull();

    const replayEvent = await prisma.outboxEvent.create({
      data: {
        type: 'features.compute',
        payload: {
          runId: fixture.jobExecutionId,
          leadId: fixture.leadId,
          icpProfileId: fixture.icpProfileId,
          snapshotVersion: 1,
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(replayEvent.id);

    const replayCount = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(replayCount).toBe(0);
    expect(boss.send).toHaveBeenCalledTimes(1);

    const suppressedReplay = await prisma.outboxEvent.findUnique({
      where: { id: replayEvent.id },
    });
    expect(suppressedReplay?.status).toBe('sent');
    expect(suppressedReplay?.lastError).toContain('already running');
  });

  it('marks outbox events as failed and schedules retry when publish fails', async () => {
    const fixture = await createQueuedJobFixture();
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'lead.enrich.stub',
        payload: {
          leadId: fixture.leadId,
          jobExecutionId: fixture.jobExecutionId,
          source: 'test',
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(async () => {
        throw new Error('queue unavailable');
      }),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(0);
    expect(boss.send).toHaveBeenCalledTimes(1);

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('failed');
    expect(updated?.attempts).toBe(1);
    expect(updated?.nextAttemptAt).not.toBeNull();
    expect(updated?.lastError).toContain('queue unavailable');
  });

  it('replays failed message.send outbox rows through the dispatcher instead of treating them as invalid', async () => {
    const scheduledAt = new Date(Date.now() + 60_000);
    const fixture = await createMessageSendDispatchFixture({ scheduledAt });
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'message.send',
        payload: {
          runId: fixture.sendId,
          sendId: fixture.sendId,
          messageDraftId: fixture.messageDraftId,
          messageVariantId: fixture.messageVariantId,
          idempotencyKey: fixture.idempotencyKey,
          channel: fixture.channel,
          scheduledAt: scheduledAt.toISOString(),
        },
        status: 'failed',
        nextAttemptAt: new Date(0),
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(
        async (_name: string, _payload?: unknown, _options?: Record<string, unknown>) => 'ok',
      ),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(1);
    expect(boss.send).toHaveBeenCalledTimes(1);

    const sendOptions = vi.mocked(boss.send).mock.calls.at(0)?.[2];
    expect(sendOptions).toMatchObject({
      singletonKey: `message.send:${fixture.sendId}`,
      retryLimit: 5,
      retryDelay: 90,
      retryBackoff: true,
      deadLetter: 'message.send.dead_letter',
    });
    expect(sendOptions?.startAfter).toEqual(scheduledAt);

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('sent');
    expect(updated?.attempts).toBe(1);
    expect(updated?.nextAttemptAt).toBeNull();
  });

  it('uses database time to gate failed retries and stale processing reclaim', async () => {
    const fixture = await createQueuedJobFixture();
    const dbNow = new Date();

    const failedEvent = await prisma.outboxEvent.create({
      data: {
        type: 'lead.enrich.stub',
        payload: {
          leadId: fixture.leadId,
          jobExecutionId: fixture.jobExecutionId,
          source: 'test',
        },
        status: 'failed',
        nextAttemptAt: new Date(dbNow.getTime() + 60_000),
      },
    });
    const processingEvent = await prisma.outboxEvent.create({
      data: {
        type: 'lead.enrich.stub',
        payload: {
          leadId: fixture.leadId,
          jobExecutionId: fixture.jobExecutionId,
          source: 'test',
        },
        status: 'processing',
      },
    });
    createdOutboxIds.push(failedEvent.id, processingEvent.id);

    await prisma.$executeRaw`
      UPDATE "OutboxEvent"
      SET "updatedAt" = ${new Date(dbNow.getTime() - 4 * 60 * 1000)}
      WHERE id = ${processingEvent.id}
    `;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(dbNow.getTime() + 2 * 60 * 1000));

    try {
      const boss = {
        send: vi.fn(async () => 'ok'),
      };
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

      expect(count).toBe(0);
      expect(boss.send).not.toHaveBeenCalled();

      const [failedState, processingState] = await Promise.all([
        prisma.outboxEvent.findUnique({
          where: { id: failedEvent.id },
        }),
        prisma.outboxEvent.findUnique({
          where: { id: processingEvent.id },
        }),
      ]);

      expect(failedState?.status).toBe('failed');
      expect(failedState?.attempts).toBe(0);
      expect(processingState?.status).toBe('processing');
      expect(processingState?.attempts).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('promotes failed outbox events to dead letter after max attempts', async () => {
    const fixture = await createQueuedJobFixture();
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'lead.enrich.stub',
        payload: {
          leadId: fixture.leadId,
          jobExecutionId: fixture.jobExecutionId,
          source: 'test',
        },
        status: 'pending',
        attempts: 5,
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(async () => 'ok'),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('dead_letter');
    expect(updated?.lastError).toContain('Max dispatch attempts exceeded');
    expect(updated?.nextAttemptAt).toBeNull();
    expect(updated?.processedAt).not.toBeNull();
  });

  it('keeps malformed message.send outbox rows invalid', async () => {
    const event = await prisma.outboxEvent.create({
      data: {
        type: 'message.send',
        payload: {
          runId: 'message.send:send_invalid',
          messageDraftId: 'draft_invalid',
          messageVariantId: 'variant_invalid',
          idempotencyKey: 'invalid-payload',
          channel: 'EMAIL',
        },
        status: 'pending',
      },
    });
    createdOutboxIds.push(event.id);

    const boss = {
      send: vi.fn(async () => 'ok'),
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const count = await dispatchPendingOutboxEvents(boss as unknown as Pick<PgBoss, 'send'>, logger);

    expect(count).toBe(0);
    expect(boss.send).not.toHaveBeenCalled();

    const updated = await prisma.outboxEvent.findUnique({
      where: { id: event.id },
    });
    expect(updated?.status).toBe('dead_letter');
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe('Invalid outbox payload');
  });
});
