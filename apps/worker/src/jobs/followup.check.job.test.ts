import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, pipelineSettingsMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      messageSend: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      messageDraft: {
        findMany: vi.fn(),
      },
    },
  },
  pipelineSettingsMock: {
    getFollowUpMaxCount: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getFollowUpMaxCount: pipelineSettingsMock.getFollowUpMaxCount,
}));

import {
  handleFollowupCheckJob,
  type FollowupCheckJobPayload,
} from './followup.check.job.js';

function makeJob(data: FollowupCheckJobPayload): Job<FollowupCheckJobPayload> {
  return {
    id: randomUUID(),
    name: 'followup.check',
    data,
  } as Job<FollowupCheckJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleFollowupCheckJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    pipelineSettingsMock.getFollowUpMaxCount.mockResolvedValue(3);
    dbMock.prisma.messageSend.findMany.mockResolvedValue([
      {
        id: 'send_1',
        leadId: 'lead_1',
        followUpNumber: 0,
        channel: 'EMAIL',
        lead: {
          id: 'lead_1',
          feedbackEvents: [],
        },
        messageDraft: {
          icpProfileId: 'icp_1',
          pitchedFeature: 'Payment Links',
        },
      },
    ]);
    dbMock.prisma.messageDraft.findMany.mockResolvedValue([
      {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        pitchedFeature: 'Payment Links',
      },
    ]);
    dbMock.prisma.messageSend.updateMany.mockResolvedValue({ count: 1 });
  });

  it('enqueues follow-up generation without stale score or approval payload state', async () => {
    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleFollowupCheckJob(
      logger,
      makeJob({
        runId: 'run_1',
        correlationId: 'corr_1',
      }),
      { boss },
    );

    expect(boss.send).toHaveBeenCalledTimes(1);
    const [jobName, payload] = boss.send.mock.calls[0] ?? [];
    expect(jobName).toBe('message.generate');
    expect(payload).toEqual({
      runId: 'followup:send_1:1',
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
      followUpNumber: 1,
      parentMessageSendId: 'send_1',
      previouslyPitchedFeatures: ['Payment Links'],
      channel: 'EMAIL',
      knowledgeEntryIds: [],
      promptVersion: 'v1-followup',
      correlationId: 'corr_1',
    });
    expect(payload).not.toHaveProperty('autoApprove');
    expect(payload).not.toHaveProperty('scorePredictionId');
    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_1',
        status: { in: ['SENT', 'REPLIED'] },
        followUpNumber: 0,
        nextFollowUpAfter: { not: null, lte: expect.any(Date) },
        lead: {
          deletedAt: null,
          status: { in: ['messaged', 'replied'] },
          feedbackEvents: {
            none: {
              eventType: { in: ['UNSUBSCRIBED', 'MEETING_BOOKED', 'DEAL_WON', 'BOUNCED'] },
            },
          },
        },
      },
      data: { nextFollowUpAfter: null },
    });
  });

  it('skips enqueue when another worker already claimed the follow-up slot', async () => {
    dbMock.prisma.messageSend.updateMany.mockResolvedValueOnce({ count: 0 });
    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleFollowupCheckJob(
      logger,
      makeJob({
        runId: 'run_1',
        correlationId: 'corr_1',
      }),
      { boss },
    );

    expect(boss.send).not.toHaveBeenCalled();
  });

  it('clears scheduled follow-ups when terminal feedback already exists', async () => {
    dbMock.prisma.messageSend.findMany.mockResolvedValue([
      {
        id: 'send_1',
        leadId: 'lead_1',
        followUpNumber: 0,
        channel: 'EMAIL',
        lead: {
          id: 'lead_1',
          feedbackEvents: [{ id: 'feedback_1' }],
        },
        messageDraft: {
          icpProfileId: 'icp_1',
          pitchedFeature: 'Payment Links',
        },
      },
    ]);
    const boss = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    await handleFollowupCheckJob(
      logger,
      makeJob({
        runId: 'run_1',
        correlationId: 'corr_1',
      }),
      { boss },
    );

    expect(dbMock.prisma.messageSend.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'send_1',
        nextFollowUpAfter: { not: null },
        lead: {
          feedbackEvents: {
            some: {
              eventType: { in: ['UNSUBSCRIBED', 'MEETING_BOOKED', 'DEAL_WON', 'BOUNCED'] },
            },
          },
        },
      },
      data: { nextFollowUpAfter: null },
    });
    expect(boss.send).not.toHaveBeenCalled();
  });
});
