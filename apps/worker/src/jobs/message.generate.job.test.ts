import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMock, pipelineSettingsMock, trackerMock, pipelineEventsMock } = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      $transaction: vi.fn(),
      lead: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      messageDraft: {
        findFirst: vi.fn(),
        update: vi.fn(),
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
  pipelineEventsMock: {
    recordPipelineEvent: vi.fn(),
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

vi.mock('../utils/pipeline-events.js', () => ({
  recordPipelineEvent: pipelineEventsMock.recordPipelineEvent,
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

function buildSuccessfulOpenAiAdapter() {
  return {
    isConfigured: true,
    generateMessageVariants: vi.fn(async () => ({
      status: 'success' as const,
      data: {
        model: 'gpt-4o',
        message: {
          subject: 'Worth a look?',
          bodyText:
            'I noticed Ada handles trust-heavy conversations where payment certainty matters and manual follow-up slows things down. Zbooni helps teams confirm payments inside the conversation and reduce chasing without changing the way they already sell today. Would it be useful if I showed a simple example?',
          bodyHtml: null,
          ctaText: 'Would it be useful if I showed a simple example?',
        },
      },
    })),
  };
}

describe('handleMessageGenerateJob eligibility and approval enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.prisma.$transaction.mockImplementation(async (callback: (tx: typeof dbMock.prisma) => Promise<unknown>) => callback(dbMock.prisma));

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
    dbMock.prisma.messageDraft.update.mockResolvedValue({});
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
      approvalStatus: 'PENDING',
      variants: [
        {
          id: 'variant_1',
          channel: 'EMAIL',
          variantKey: 'variant_a',
          isSelected: false,
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

    const openAiAdapter = buildSuccessfulOpenAiAdapter();

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
      { openAiAdapter: openAiAdapter as never },
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

    const openAiAdapter = buildSuccessfulOpenAiAdapter();

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
      { openAiAdapter: openAiAdapter as never },
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

    const openAiAdapter = buildSuccessfulOpenAiAdapter();

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
      { openAiAdapter: openAiAdapter as never },
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

  it('stores a visible lead error instead of creating a fallback draft when OpenAI returns a terminal error', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(async () => ({
        status: 'terminal_error' as const,
        failure: {
          classification: 'terminal' as const,
          statusCode: 401,
          message: 'invalid_api_key',
          raw: null,
        },
      })),
    };

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
      { openAiAdapter: openAiAdapter as never },
    );

    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead_1' },
      data: {
        error: 'Draft generation failed because the AI provider returned an invalid response. No draft was created.',
      },
    });
    expect(pipelineEventsMock.recordPipelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead_1',
        stage: 'message.generate',
        status: 'FAILED',
      }),
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('keeps the existing draft when regeneration fails', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    dbMock.prisma.messageDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'draft_existing',
        approvalStatus: 'PENDING',
        variants: [
          {
            id: 'variant_existing',
            channel: 'EMAIL',
            variantKey: 'variant_a',
            isSelected: false,
          },
        ],
      });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(async () => ({
        status: 'terminal_error' as const,
        failure: {
          classification: 'terminal' as const,
          statusCode: 400,
          message: 'invalid_response',
          raw: null,
        },
      })),
    };

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
        forceRegenerate: true,
      }),
      { openAiAdapter: openAiAdapter as never },
    );

    expect(dbMock.prisma.messageDraft.update).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead_1' },
      data: {
        error: 'Draft generation failed because the AI provider returned an invalid response. Your existing draft was kept.',
      },
    });
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('supersedes the old draft only after a regenerated replacement succeeds', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    dbMock.prisma.messageDraft.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'draft_existing',
        approvalStatus: 'PENDING',
        variants: [
          {
            id: 'variant_existing',
            channel: 'EMAIL',
            variantKey: 'variant_a',
            isSelected: false,
          },
        ],
      });

    const openAiAdapter = buildSuccessfulOpenAiAdapter();

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
        forceRegenerate: true,
      }),
      { openAiAdapter: openAiAdapter as never },
    );

    expect(dbMock.prisma.messageDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft_existing' },
      data: {
        approvalStatus: 'REJECTED',
        rejectedReason: 'Superseded by regenerated draft',
        approvedByUserId: null,
        approvedAt: null,
      },
    });
    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalled();
  });

  it('skips stale follow-up generation when the lead is no longer in a follow-up-eligible state', async () => {
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: null,
      decisionMakerPhone: null,
      businessId: null,
      deletedAt: null,
      status: 'cold',
    });

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        followUpNumber: 1,
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.leadScorePrediction.findFirst).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('keeps already-messaged leads closed to initial draft generation', async () => {
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: null,
      decisionMakerPhone: null,
      businessId: null,
      deletedAt: null,
      status: 'messaged',
    });

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_2',
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
    );

    expect(dbMock.prisma.leadScorePrediction.findFirst).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageDraft.findFirst).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('does not auto-send a reused pending draft on retry', async () => {
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+15555550123',
      decisionMakerPhone: '+15555550123',
      businessId: null,
      deletedAt: null,
      status: 'messaged',
    });
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.91,
    });
    dbMock.prisma.messageDraft.findFirst.mockResolvedValue({
      id: 'draft_existing',
      approvalStatus: 'PENDING',
      variants: [
        {
          id: 'variant_existing',
          channel: 'WHATSAPP',
          variantKey: 'variant_a',
          isSelected: false,
        },
      ],
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(),
    };

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        followUpNumber: 1,
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
      {
        openAiAdapter: openAiAdapter as never,
        boss: { send: vi.fn() },
      },
    );

    expect(openAiAdapter.generateMessageVariants).not.toHaveBeenCalled();
    expect(pipelineSettingsMock.loadAutoApproveConfig).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.create).not.toHaveBeenCalled();
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
  });

  it('heals a missing send for a reused auto-approved draft without regenerating content', async () => {
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+15555550123',
      decisionMakerPhone: '+15555550123',
      businessId: null,
      deletedAt: null,
      status: 'messaged',
    });
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.91,
    });
    dbMock.prisma.messageDraft.findFirst.mockResolvedValue({
      id: 'draft_existing',
      approvalStatus: 'AUTO_APPROVED',
      variants: [
        {
          id: 'variant_existing',
          channel: 'WHATSAPP',
          variantKey: 'variant_a',
          isSelected: true,
        },
      ],
    });
    dbMock.prisma.messageSend.create.mockResolvedValue({
      id: 'send_existing',
      idempotencyKey: 'followup:lead_1:draft_existing:variant_existing',
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(),
    };
    const boss = { send: vi.fn().mockResolvedValue(undefined) };

    await handleMessageGenerateJob(
      logger,
      makeJob({
        runId: 'run_1',
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        followUpNumber: 1,
        knowledgeEntryIds: [],
        promptVersion: 'v2',
      }),
      {
        openAiAdapter: openAiAdapter as never,
        boss,
      },
    );

    expect(openAiAdapter.generateMessageVariants).not.toHaveBeenCalled();
    expect(pipelineSettingsMock.loadAutoApproveConfig).not.toHaveBeenCalled();
    expect(dbMock.prisma.messageSend.create).toHaveBeenCalledWith({
      data: {
        leadId: 'lead_1',
        messageDraftId: 'draft_existing',
        messageVariantId: 'variant_existing',
        channel: 'WHATSAPP',
        provider: 'TRENGO',
        status: 'QUEUED',
        idempotencyKey: 'followup:lead_1:draft_existing:variant_existing',
        followUpNumber: 1,
      },
    });
    expect(boss.send).toHaveBeenCalledWith(
      'message.send',
      expect.objectContaining({
        sendId: 'send_existing',
        messageDraftId: 'draft_existing',
        messageVariantId: 'variant_existing',
        channel: 'WHATSAPP',
        followUpNumber: 1,
      }),
      expect.objectContaining({
        singletonKey: 'message.send:send_existing',
      }),
    );
    expect(trackerMock.tryFinalizeDiscoveryRun).toHaveBeenCalledWith('run_1', logger);
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
        approvalStatus: 'PENDING',
        variants: [
          {
            id: 'variant_existing',
            channel: 'EMAIL',
            variantKey: 'variant_a',
            isSelected: false,
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
