import type PgBoss from 'pg-boss';
import { prisma } from '@lead-flood/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchPendingOutboxEvents } from './outbox-dispatcher.js';

describe('dispatchPendingOutboxEvents', () => {
  const createdOutboxIds: string[] = [];
  const createdJobIds: string[] = [];
  const createdLeadIds: string[] = [];

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
});
