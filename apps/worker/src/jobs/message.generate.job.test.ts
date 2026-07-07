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

const ZBOONI_INTRO =
  'I’m reaching out from Leadzilla. We help businesses turn customer messages into paid, trackable orders. When a customer asks about a product, your team can send a cart, collect payment, and track the sale from the same conversation.';

function buildSuccessfulOpenAiAdapter() {
  return {
    isConfigured: true,
    generateMessageVariants: vi.fn(async () => ({
      status: 'success' as const,
      data: {
        model: 'gpt-4o-mini',
        message: {
          subject: 'Track chat-driven orders?',
          bodyText:
            `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor a team handling trust-heavy customer conversations, that can make follow-up and payment status easier to manage without changing how you already sell today. Would it be useful to compare this with your current conversation-to-order flow?\n\nBest,\nLeadzilla Team`,
          bodyHtml: null,
          ctaText: 'Would it be useful to compare this with your current conversation-to-order flow?',
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
      businessEmail: null,
      phone: null,
      decisionMakerTitle: null,
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
    dbMock.prisma.business.findUnique.mockResolvedValue(null);
    dbMock.prisma.businessConversion.findFirst.mockResolvedValue(null);
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

  it('passes decision-maker recipient context into OpenAI generation', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
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
      }),
      { openAiAdapter: openAiAdapter as never },
    );

    expect(openAiAdapter.generateMessageVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipientType: 'DECISION_MAKER',
        recipientName: 'Ada Lovelace',
        recipientEmailKind: 'PERSONAL',
      }),
    );
  });

  it('passes operator re-draft feedback into OpenAI generation', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
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
        redraftFeedback: 'Make the subject clearer and keep the tone less personal.',
      }),
      { openAiAdapter: openAiAdapter as never },
    );

    expect(openAiAdapter.generateMessageVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        redraftFeedback: 'Make the subject clearer and keep the tone less personal.',
      }),
    );
  });

  it('passes generic-contact recipient context for business inbox leads', async () => {
    dbMock.prisma.lead.findUnique.mockResolvedValue({
      id: 'lead_1',
      firstName: 'Unknown',
      lastName: 'Contact',
      email: 'info@rady.example',
      businessEmail: 'info@rady.example',
      phone: null,
      decisionMakerTitle: null,
      decisionMakerPhone: null,
      businessId: 'business_1',
      deletedAt: null,
      status: 'qualified',
    });
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });
    dbMock.prisma.business.findUnique.mockResolvedValue({
      name: 'Rady Interior',
      apifyWebsiteScrapeJson: null,
      apifyInstagramScrapeJson: null,
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(async () => ({
        status: 'success' as const,
        data: {
          model: 'gpt-4o-mini',
          message: {
            subject: 'Track chat orders?',
            bodyText:
              `Hi Rady Interior team,\n\n${ZBOONI_INTRO}\n\nFor a service business like Rady Interior, that can make WhatsApp follow-up, order details, and payment status easier to manage from one place. Would it be useful to compare this with how your team handles chat-driven orders today?\n\nBest,\nLeadzilla Team`,
            bodyHtml: null,
            ctaText: 'Would it be useful to compare this with how your team handles chat-driven orders today?',
          },
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

    expect(openAiAdapter.generateMessageVariants).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipientType: 'GENERIC_CONTACT',
        recipientName: null,
        recipientEmailKind: 'GENERIC',
        companyName: 'Rady Interior',
      }),
    );
  });

  it('stores the CTA in bodyText when OpenAI returns ctaText separately', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(async () => ({
        status: 'success' as const,
        data: {
          model: 'gpt-4o-mini',
          message: {
            subject: 'Track customer orders?',
            bodyText:
              `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status and customer follow-up easier to track from the same conversation.`,
            bodyHtml: null,
            ctaText: 'Would it be useful to compare this with your current handoff from conversation to order?',
          },
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

    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          variants: {
            create: [
              expect.objectContaining({
                bodyText: expect.stringMatching(
                  /Would it be useful to compare this with your current handoff from conversation to order\?\s+Best,\s+Leadzilla Team/,
                ),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('regenerates instead of saving a draft that has no closing question', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn()
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: {
            model: 'gpt-4o-mini',
            message: {
              subject: 'Track customer orders?',
              bodyText:
                `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status and customer follow-up easier to track from the same conversation.`,
              bodyHtml: null,
              ctaText: null,
            },
          },
        })
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: {
            model: 'gpt-4o-mini',
            message: {
              subject: 'Track customer orders?',
              bodyText:
                `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status and customer follow-up easier to track from the same conversation. Would a quick comparison with your current order flow be useful?\n\nBest,\nLeadzilla Team`,
              bodyHtml: null,
              ctaText: 'Would a quick comparison with your current order flow be useful?',
            },
          },
        }),
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

    expect(openAiAdapter.generateMessageVariants).toHaveBeenCalledTimes(2);
    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          variants: {
            create: [
              expect.objectContaining({
                bodyText: expect.stringContaining('Would a quick comparison with your current order flow be useful?'),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('keeps retrying validation failures with validator feedback until a compliant draft is generated', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn()
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: {
            model: 'gpt-4o-mini',
            message: {
              subject: 'Act now?',
              bodyText:
                `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status easier to track from the same conversation. Act now if this is useful? \n\nBest,\nLeadzilla Team`,
              bodyHtml: null,
              ctaText: null,
            },
          },
        })
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: {
            model: 'gpt-4o-mini',
            message: {
              subject: 'Track project payments?',
              bodyText:
                `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status easier to track from the same conversation.\n\nBest,\nLeadzilla Team`,
              bodyHtml: null,
              ctaText: null,
            },
          },
        })
        .mockResolvedValueOnce({
          status: 'success' as const,
          data: {
            model: 'gpt-4o-mini',
            message: {
              subject: 'Track project payments?',
              bodyText:
                `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status easier to track from the same conversation. Would it be useful to compare this with your current order flow?\n\nBest,\nLeadzilla Team`,
              bodyHtml: null,
              ctaText: 'Would it be useful to compare this with your current order flow?',
            },
          },
        }),
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

    expect(openAiAdapter.generateMessageVariants).toHaveBeenCalledTimes(3);
    expect(openAiAdapter.generateMessageVariants).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        icpDescription: expect.stringContaining('Contains spam trigger words: act now'),
      }),
    );
    expect(openAiAdapter.generateMessageVariants).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        icpDescription: expect.stringContaining('Missing low-friction closing question'),
      }),
    );
    expect(dbMock.prisma.messageDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          variants: {
            create: [
              expect.objectContaining({
                bodyText: expect.stringContaining('Would it be useful to compare this with your current order flow?'),
              }),
            ],
          },
        }),
      }),
    );
    expect(
      dbMock.prisma.lead.updateMany.mock.calls.some(([arg]) =>
        typeof arg?.data?.error === 'string' &&
        arg.data.error.includes('AI response did not pass message quality checks'),
      ),
    ).toBe(false);
  });

  it('retries the job instead of showing a lead error when validation attempts are exhausted', async () => {
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({
      id: 'score_current',
      scoreBand: 'HIGH',
      blendedScore: 0.72,
    });

    const openAiAdapter = {
      isConfigured: true,
      generateMessageVariants: vi.fn(async () => ({
        status: 'success' as const,
        data: {
          model: 'gpt-4o-mini',
          message: {
            subject: 'Act now?',
            bodyText:
              `Hi Ada,\n\n${ZBOONI_INTRO}\n\nFor project-based sales, that can make payment status easier to track from the same conversation. Act now if this is useful?\n\nBest,\nLeadzilla Team`,
            bodyHtml: null,
            ctaText: null,
          },
        },
      })),
    };

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
        { openAiAdapter: openAiAdapter as never },
      ),
    ).rejects.toBeInstanceOf(RetryableError);

    expect(openAiAdapter.generateMessageVariants).toHaveBeenCalledTimes(5);
    expect(dbMock.prisma.messageDraft.create).not.toHaveBeenCalled();
    expect(
      dbMock.prisma.lead.updateMany.mock.calls.some(([arg]) =>
        typeof arg?.data?.error === 'string' &&
        arg.data.error.includes('AI response did not pass message quality checks'),
      ),
    ).toBe(false);
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

  it('reuses an auto-approved draft without creating or enqueueing a send while outbound is disabled', async () => {
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
    expect(dbMock.prisma.messageSend.create).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: 'draft_existing',
        followUpNumber: 1,
      }),
      'Auto-approved draft retained without enqueueing message.send because outbound sending is disabled',
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
