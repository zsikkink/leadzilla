import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const { dbMock, pipelineSettingsMock, queuesMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      lead: {
        update: vi.fn(),
      },
    },
  },
  pipelineSettingsMock: {
    getPipelineSettings: vi.fn(),
  },
  queuesMock: {
    WORKER_QUEUE_DEFINITIONS: [
      {
        name: 'business.convert',
        retryOptions: {
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          deadLetter: 'business.convert.dead_letter',
        },
      },
      {
        name: 'message.send',
        retryOptions: {
          retryLimit: 5,
          retryDelay: 90,
          retryBackoff: true,
          deadLetter: 'message.send.dead_letter',
        },
      },
    ],
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getPipelineSettings: pipelineSettingsMock.getPipelineSettings,
}));

vi.mock('../queues.js', () => ({
  WORKER_QUEUE_DEFINITIONS: queuesMock.WORKER_QUEUE_DEFINITIONS,
}));

import {
  type DlqProcessJobDependencies,
  handleDlqProcessJob,
  type DlqProcessJobPayload,
} from './dlq.process.job.js';

function makeJob(data: DlqProcessJobPayload = {}): Job<DlqProcessJobPayload> {
  return {
    id: randomUUID(),
    name: 'dlq.process',
    data,
  } as Job<DlqProcessJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createBossWithQueueBatches(
  queueBatches: Record<string, Array<Array<{ id: string; data?: Record<string, unknown> }>>>,
): DlqProcessJobDependencies['boss'] {
  return {
    fetch: vi.fn(async (queueName: string) => {
      const batches = queueBatches[queueName];
      if (!batches || batches.length === 0) {
        return [];
      }
      return (batches.shift() ?? []) as Job<Record<string, unknown>>[];
    }),
    send: vi.fn(async () => randomUUID()),
    complete: vi.fn(async () => undefined),
    getQueueSize: vi.fn(async () => 0),
  } as unknown as DlqProcessJobDependencies['boss'];
}

describe('handleDlqProcessJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineSettingsMock.getPipelineSettings.mockResolvedValue({
      dlqMaxRetries: 3,
      dlqBatchSize: 50,
    });
  });

  it('re-enqueues discovery pipeline dead letter jobs immediately', async () => {
    const boss = createBossWithQueueBatches({
      'business.convert.dead_letter': [
        [
          {
            id: 'dead-job-1',
            data: {
              dlqRetryCount: 0,
              discoveryRunId: 'run_1',
              businessId: 'business_1',
              icpProfileId: 'icp_1',
            },
          },
        ],
      ],
    });

    await handleDlqProcessJob(logger, makeJob(), { boss });

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledWith(
      'business.convert',
      expect.objectContaining({
        dlqRetryCount: 1,
        discoveryRunId: 'run_1',
        businessId: 'business_1',
      }),
    );
    expect((boss.send as Mock).mock.calls[0]).toHaveLength(2);
    expect(boss.complete).toHaveBeenCalledWith(
      'business.convert.dead_letter',
      'dead-job-1',
    );
  });

  it('keeps delayed backoff for non-discovery dead letter jobs', async () => {
    const boss = createBossWithQueueBatches({
      'message.send.dead_letter': [
        [
          {
            id: 'dead-job-2',
            data: {
              dlqRetryCount: 0,
              leadId: 'lead_1',
            },
          },
        ],
      ],
    });

    await handleDlqProcessJob(logger, makeJob(), { boss });

    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      expect.objectContaining({
        dlqRetryCount: 1,
        leadId: 'lead_1',
      }),
      { startAfter: 3600 },
    );
    expect((boss.send as Mock).mock.calls[0]).toHaveLength(3);
    expect(boss.complete).toHaveBeenCalledWith(
      'message.send.dead_letter',
      'dead-job-2',
    );
  });
});
