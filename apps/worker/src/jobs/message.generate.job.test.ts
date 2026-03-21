import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, pipelineSettingsMock, trackerMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      lead: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      messageDraft: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      messageSend: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      leadScorePrediction: {
        findFirst: vi.fn(),
      },
      icpProfile: {
        findUnique: vi.fn(),
      },
      leadFeatureSnapshot: {
        findFirst: vi.fn(),
      },
      leadEnrichmentRecord: {
        findFirst: vi.fn(),
      },
      business: {
        findUnique: vi.fn(),
      },
      businessConversion: {
        findFirst: vi.fn(),
      },
    },
  },
  pipelineSettingsMock: {
    getMessagingInstructions: vi.fn(),
    getMessagingRole: vi.fn(),
    getMessagingSystemPrompt: vi.fn(),
    isManualApprovalOnlyEnabled: vi.fn(),
    loadAutoApproveConfig: vi.fn(),
    loadVerifiedScoreQualificationThreshold: vi.fn(),
    shouldAutoApprove: vi.fn(),
  },
  trackerMock: {
    tryFinalizeDiscoveryRun: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
  toInputJson: (value: unknown) => value,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getMessagingInstructions: pipelineSettingsMock.getMessagingInstructions,
  getMessagingRole: pipelineSettingsMock.getMessagingRole,
  getMessagingSystemPrompt: pipelineSettingsMock.getMessagingSystemPrompt,
  isManualApprovalOnlyEnabled: pipelineSettingsMock.isManualApprovalOnlyEnabled,
  loadAutoApproveConfig: pipelineSettingsMock.loadAutoApproveConfig,
  loadVerifiedScoreQualificationThreshold: pipelineSettingsMock.loadVerifiedScoreQualificationThreshold,
  shouldAutoApprove: pipelineSettingsMock.shouldAutoApprove,
}));

vi.mock('../utils/discovery-run-tracker.js', () => ({
  tryFinalizeDiscoveryRun: trackerMock.tryFinalizeDiscoveryRun,
}));

import { RetryableError } from '../errors.js';
import {
  handleMessageGenerateJob,
  type MessageGenerateJobPayload,
} from './message.generate.job.js';

function makeJob(data: MessageGenerateJobPayload): Job<MessageGenerateJobPayload> {
  return {
    id: randomUUID(),
    name: 'message.generate',
    data,
  } as Job<MessageGenerateJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleMessageGenerateJob eligibility and approval enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: null,
      decisionMakerPhone: null,
      businessId: null,
      deletedAt: null,
      status: 'qualified',
    });
    dbMock.prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.messageDraft.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageSend.findFirst.mockResolvedValue(null);
    pipelineSettingsMock.loadVerifiedScoreQualificationThreshold.mockResolvedValue(0.6);
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
    pipelineSettingsMock.getMessagingInstructions.mockResolvedValue(null);
    pipelineSettingsMock.getMessagingRole.mockResolvedValue(null);
    pipelineSettingsMock.getMessagingSystemPrompt.mockResolvedValue(null);
    pipelineSettingsMock.isManualApprovalOnlyEnabled.mockResolvedValue(false);
    pipelineSettingsMock.loadAutoApproveConfig.mockResolvedValue({
      enabled: false,
      scoreMin: 100,
      scoreMax: 100,
    });
    pipelineSettingsMock.shouldAutoApprove.mockReturnValue(false);
    dbMock.prisma.icpProfile.findUnique.mockResolvedValue({
      name: 'ICP Profile',
      description: 'Helps merchants collect payments faster.',
      featureList: ['Payment Links'],
      metadataJson: { salesHook: 'Faster payment collection' },
    });
    dbMock.prisma.leadFeatureSnapshot.findFirst.mockResolvedValue(null);
    dbMock.prisma.leadEnrichmentRecord.findFirst.mockResolvedValue(null);
    dbMock.prisma.messageDraft.create.mockResolvedValue({
      id: 'draft_1',
      variants: [
        {
          id: 'variant_1',
          channel: 'EMAIL',
          variantKey: 'variant_a',
        },
      ],
    });
  });

  it('skips when no current score exists for the requested ICP profile', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue(null);

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.leadScorePrediction.findFirst).toHaveBeenCalledWith({
      where: { leadId: 'lead_1', icpProfileId: 'icp_1' },
      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, scoreBand: true, blendedScore: true },
    });
    expect(pipelineSettingsMock.loadVerifiedScoreQualificationThreshold).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('skips when the latest server-loaded score is below the verified threshold', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'MEDIUM',
      blendedScore: 0.42,
    });
    pipelineSettingsMock.loadVerifiedScoreQualificationThreshold.mockResolvedValue(0.5);

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.icpProfile.findUnique).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('throws a retryable error when the verified threshold cannot be loaded', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    pipelineSettingsMock.loadVerifiedScoreQualificationThreshold.mockRejectedValue(
      new Error('Failed to load scoreQualificationThreshold: db unavailable'),
    );

    await expect(
      handleMessageGenerateJob(
        logger,
        makeJob({
          runId: 'run_1',
          leadId: 'lead_1',
          icpProfileId: 'icp_1',
          knowledgeEntryIds: [],
          promptVersion: 'v2',
        }),
      ),
    ).rejects.toBeInstanceOf(RetryableError);

    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).not.toHaveBeenCalled();
  });

  it('keeps drafts pending when current settings do not allow auto-approval', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    pipelineSettingsMock.loadAutoApproveConfig.mockResolvedValue({
      enabled: false,
      scoreMin: 0.7,
      scoreMax: 0.9,
    });
    pipelineSettingsMock.shouldAutoApprove.mockReturnValue(false);

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(pipelineSettingsMock.loadAutoApproveConfig).toHaveBeenCalledTimes(1);
    expect(pipelineSettingsMock.shouldAutoApprove).toHaveBeenCalledWith(
      {
        enabled: false,
        scoreMin: 0.7,
        scoreMax: 0.9,
      },
      0.72,
    );
    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scorePredictionId: 'score_current',
          approvalStatus: 'PENDING',
          variants: {
            create: [
              expect.objectContaining({
                isSelected: false,
              }),
            ],
          },
        }),
      }),
    );
    expect(dbMock.prisma.messageSend.create).not.toHaveBeenCalled();
  });

  it('auto-approves when current settings and score require it', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.84,
    });
    pipelineSettingsMock.loadAutoApproveConfig.mockResolvedValue({
      enabled: true,
      scoreMin: 0.8,
      scoreMax: 0.95,
    });
    pipelineSettingsMock.shouldAutoApprove.mockReturnValue(true);

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(pipelineSettingsMock.loadAutoApproveConfig).toHaveBeenCalledTimes(1);
    expect(pipelineSettingsMock.shouldAutoApprove).toHaveBeenCalledWith(
      {
        enabled: true,
        scoreMin: 0.8,
        scoreMax: 0.95,
      },
      0.84,
    );
    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvalStatus: 'AUTO_APPROVED',
          variants: {
            create: [
              expect.objectContaining({
                isSelected: true,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('forces pending approval when manual-approval-only is currently enabled', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.91,
    });
    pipelineSettingsMock.loadAutoApproveConfig.mockResolvedValue({
      enabled: true,
      scoreMin: 0.8,
      scoreMax: 0.95,
    });
    pipelineSettingsMock.shouldAutoApprove.mockReturnValue(true);
    pipelineSettingsMock.isManualApprovalOnlyEnabled.mockResolvedValue(true);

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvalStatus: 'PENDING',
          variants: {
            create: [
              expect.objectContaining({
                isSelected: false,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('restores drafted status when retry reuses an existing initial draft', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    dbMock.prisma.messageDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'draft_existing',
        variants: [
          {
            id: 'variant_existing',
            channel: 'EMAIL',
            variantKey: 'variant_a',
          },
        ],
      });

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        status: 'qualified',
      },
      data: { status: 'drafted' },
    });
  });

  it('loads BusinessConversion only from the lead primary business context', async () => {
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: null,
      decisionMakerPhone: null,
      businessId: 'business_primary_1',
      deletedAt: null,
      status: 'qualified',
    });
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    dbMock.prisma.business.findUnique.mockResolvedValue({
      name: 'Primary Business',
      apifyWebsiteScrapeJson: null,
      apifyInstagramScrapeJson: null,
    });
    dbMock.prisma.businessConversion.findFirst.mockResolvedValue({
      businessInsights: 'Slow payment collection',
    });

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.businessConversion.findFirst).toHaveBeenCalledWith({
      where: {
        leadId: 'lead_1',
        businessId: 'business_primary_1',
      },
      select: { businessInsights: true },
      orderBy: { createdAt: 'desc' },
    });
  });
});
