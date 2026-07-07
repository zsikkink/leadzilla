import { randomUUID } from 'node:crypto';

import type { OpenAiAdapter } from '@lead-flood/providers';
import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbMock,
  scoringMock,
  sharedMock,
  pipelineSettingsMock,
  trackerMock,
} = vi.hoisted(() => ({
  dbMock: {
    prisma: {
      lead: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
      leadFeatureSnapshot: {
        findFirst: vi.fn(),
      },
      qualificationRule: {
        findMany: vi.fn(),
      },
      leadScorePrediction: {
        upsert: vi.fn(),
      },
      leadRejection: {
        upsert: vi.fn(),
        deleteMany: vi.fn(),
      },
      businessConversion: {
        findFirst: vi.fn(),
      },
      jobExecution: {
        updateMany: vi.fn(),
      },
      icpProfile: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
    },
  },
  scoringMock: {
    evaluateDeterministicScore: vi.fn(),
    toScoreBand: vi.fn(),
    predictLogistic: vi.fn(),
  },
  sharedMock: {
    asDeterministicRules: vi.fn(),
    computeBlendRatio: vi.fn(),
    ensureBaselineModelVersion: vi.fn(),
    extractFeatureVectorForModel: vi.fn(),
    findActiveTrainedModel: vi.fn(),
  },
  pipelineSettingsMock: {
    getDeterministicAiBlend: vi.fn(),
    getScoreQualificationThreshold: vi.fn(),
    getScoreTierBands: vi.fn(),
  },
  trackerMock: {
    tryFinalizeDiscoveryRun: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMock.prisma,
  toInputJson: (value: unknown) => value,
}));

vi.mock('../scoring/deterministic.js', () => ({
  evaluateDeterministicScore: scoringMock.evaluateDeterministicScore,
  toScoreBand: scoringMock.toScoreBand,
}));

vi.mock('../scoring/logistic.js', () => ({
  predictLogistic: scoringMock.predictLogistic,
}));

vi.mock('../scoring/shared.js', () => ({
  asDeterministicRules: sharedMock.asDeterministicRules,
  computeBlendRatio: sharedMock.computeBlendRatio,
  ensureBaselineModelVersion: sharedMock.ensureBaselineModelVersion,
  extractFeatureVectorForModel: sharedMock.extractFeatureVectorForModel,
  findActiveTrainedModel: sharedMock.findActiveTrainedModel,
}));

vi.mock('../utils/pipeline-settings.js', () => ({
  getDeterministicAiBlend: pipelineSettingsMock.getDeterministicAiBlend,
  getScoreQualificationThreshold: pipelineSettingsMock.getScoreQualificationThreshold,
  getScoreTierBands: pipelineSettingsMock.getScoreTierBands,
}));

vi.mock('../utils/discovery-run-tracker.js', () => ({
  tryFinalizeDiscoveryRun: trackerMock.tryFinalizeDiscoveryRun,
}));

import {
  handleScoringComputeJob,
  type ScoringComputeJobPayload,
} from './scoring.compute.job.js';

function makeJob(data: ScoringComputeJobPayload): Job<ScoringComputeJobPayload> {
  return {
    id: randomUUID(),
    name: 'scoring.compute',
    data,
  } as Job<ScoringComputeJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleScoringComputeJob primary business conversion anchoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    pipelineSettingsMock.getScoreQualificationThreshold.mockResolvedValue(0.5);
    pipelineSettingsMock.getDeterministicAiBlend.mockResolvedValue(null);
    pipelineSettingsMock.getScoreTierBands.mockResolvedValue({
      high: 0.8,
      medium: 0.5,
    });
    sharedMock.ensureBaselineModelVersion.mockResolvedValue('model_1');
    sharedMock.findActiveTrainedModel.mockResolvedValue(null);
    sharedMock.computeBlendRatio.mockResolvedValue({
      deterministicWeight: 1,
      aiWeight: 0,
    });
    sharedMock.asDeterministicRules.mockReturnValue([]);
    scoringMock.evaluateDeterministicScore.mockReturnValue({
      qualificationScore: 0.9,
      hardFilterPassed: true,
      qualificationPath: 'QUALIFIED',
      reasonCodes: [],
      categoryScores: {},
      ruleEvaluation: [],
    });
    scoringMock.toScoreBand.mockReturnValue('HIGH');
    dbMock.prisma.lead.findMany.mockResolvedValue([
      {
        id: 'lead_1',
        businessId: 'business_primary_1',
      },
    ]);
    dbMock.prisma.qualificationRule.findMany.mockResolvedValue([]);
    dbMock.prisma.leadFeatureSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot_1',
      featuresJson: {},
      computedAt: new Date(),
      createdAt: new Date(),
    });
    dbMock.prisma.leadScorePrediction.upsert.mockResolvedValue({
      id: 'prediction_1',
    });
    dbMock.prisma.lead.updateMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.businessConversion.findFirst.mockResolvedValue({
      apolloHasEmail: true,
      apolloHasDirectPhone: false,
    });
    dbMock.prisma.leadRejection.deleteMany.mockResolvedValue({ count: 0 });
    dbMock.prisma.jobExecution.updateMany.mockResolvedValue({ count: 1 });
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
  });

  it('loads BusinessConversion only from the lead primary business context before enqueueing Apollo enrich', async () => {
    const enqueueApolloEnrich = vi.fn(async () => undefined);
    const openAiAdapter = {
      isConfigured: true,
      evaluateLeadScore: vi.fn(async () => ({
        status: 'success' as const,
        data: {
          score: 0.91,
          reasoning: ['Strong fit.'],
        },
      })),
    } as unknown as OpenAiAdapter;

    await handleScoringComputeJob(
      logger,
      makeJob({
        runId: 'run_1',
        mode: 'BY_LEAD_IDS',
        leadIds: ['lead_1'],
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
      }),
      {
        enqueueApolloEnrich,
        openAiAdapter,
      },
    );

    expect(dbMock.prisma.businessConversion.findFirst).toHaveBeenCalledWith({
      where: {
        leadId: 'lead_1',
        icpProfileId: 'icp_1',
        businessId: 'business_primary_1',
      },
      select: {
        apolloHasEmail: true,
        apolloHasDirectPhone: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(enqueueApolloEnrich).toHaveBeenCalledWith({
      leadId: 'lead_1',
      icpProfileId: 'icp_1',
      scorePredictionId: 'prediction_1',
      runId: 'run_1',
      scoreBand: 'HIGH',
      apolloHasEmail: true,
      apolloHasDirectPhone: false,
      correlationId: expect.any(String),
    });
    expect(dbMock.prisma.leadRejection.deleteMany).toHaveBeenCalledWith({
      where: { leadId: 'lead_1' },
    });
  });

  it('does not enqueue provider enrichment from a deterministic fallback score', async () => {
    const enqueueApolloEnrich = vi.fn(async () => undefined);
    scoringMock.evaluateDeterministicScore.mockReturnValue({
      qualificationScore: 0.95,
      hardFilterPassed: true,
      qualificationPath: 'QUALIFIED',
      reasonCodes: [],
      categoryScores: {},
      ruleEvaluation: [],
    });

    await handleScoringComputeJob(
      logger,
      makeJob({
        runId: 'run_1',
        mode: 'BY_LEAD_IDS',
        leadIds: ['lead_1'],
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
      }),
      {
        enqueueApolloEnrich,
      },
    );

    expect(enqueueApolloEnrich).not.toHaveBeenCalled();
    expect(dbMock.prisma.businessConversion.findFirst).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadRejection.deleteMany).toHaveBeenCalledWith({
      where: { leadId: 'lead_1' },
    });
  });

  it('does not enqueue provider enrichment when the AI score is exactly 0.90', async () => {
    const enqueueApolloEnrich = vi.fn(async () => undefined);
    const openAiAdapter = {
      isConfigured: true,
      evaluateLeadScore: vi.fn(async () => ({
        status: 'success' as const,
        data: {
          score: 0.9,
          reasoning: ['Borderline fit.'],
        },
      })),
    } as unknown as OpenAiAdapter;

    await handleScoringComputeJob(
      logger,
      makeJob({
        runId: 'run_1',
        mode: 'BY_LEAD_IDS',
        leadIds: ['lead_1'],
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
      }),
      {
        enqueueApolloEnrich,
        openAiAdapter,
      },
    );

    expect(enqueueApolloEnrich).not.toHaveBeenCalled();
    expect(dbMock.prisma.businessConversion.findFirst).not.toHaveBeenCalled();
  });

  it('uses the OpenAI score as the final score with deterministic as baseline only', async () => {
    scoringMock.evaluateDeterministicScore.mockReturnValue({
      qualificationScore: 0.12,
      hardFilterPassed: true,
      qualificationPath: 'DISQUALIFY',
      reasonCodes: ['LOW_WEIGHTED_MATCH'],
      categoryScores: {},
      ruleEvaluation: [],
    });
    dbMock.prisma.icpProfile.findUnique.mockResolvedValue({
      description: 'Leadzilla ICP',
    });
    const openAiAdapter = {
      isConfigured: true,
      evaluateLeadScore: vi.fn().mockResolvedValue({
        status: 'success',
        data: {
          score: 0.82,
          reasoning: ['LLM found strong ICP fit'],
        },
      }),
    };

    await handleScoringComputeJob(
      logger,
      makeJob({
        runId: 'run_1',
        mode: 'BY_LEAD_IDS',
        leadIds: ['lead_1'],
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
      }),
      {
        openAiAdapter: openAiAdapter as unknown as OpenAiAdapter,
      },
    );

    expect(dbMock.prisma.leadScorePrediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deterministicScore: 0.12,
          logisticScore: 0.82,
          blendedScore: 0.82,
          reasonsJson: expect.objectContaining({
            aiReasoning: ['LLM found strong ICP fit'],
            scoreSource: 'llm',
          }),
        }),
      }),
    );
    expect(scoringMock.toScoreBand).toHaveBeenCalledWith(0.82, {
      high: 0.8,
      medium: 0.5,
    });
    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        status: { in: ['new', 'processing', 'enriched', 'scored', 'qualified', 'rejected', 'stuck'] },
      },
      data: { status: 'qualified' },
    });
  });

  it('does not enqueue Apollo enrich when a hard filter fails even if blended score is high', async () => {
    sharedMock.findActiveTrainedModel.mockResolvedValue({
      model: {},
    });
    sharedMock.extractFeatureVectorForModel.mockReturnValue([]);
    scoringMock.predictLogistic.mockReturnValue(0.92);
    scoringMock.evaluateDeterministicScore.mockReturnValue({
      qualificationScore: 0,
      hardFilterPassed: false,
      qualificationPath: 'HARD_FILTERED',
      reasonCodes: ['HARD_FILTER_FAILED_COUNTRY'],
      categoryScores: {},
      ruleEvaluation: [],
    });
    dbMock.prisma.leadRejection.upsert.mockResolvedValue({
      id: 'rejection_1',
    });
    const enqueueApolloEnrich = vi.fn(async () => undefined);

    await handleScoringComputeJob(
      logger,
      makeJob({
        runId: 'run_1',
        mode: 'BY_LEAD_IDS',
        leadIds: ['lead_1'],
        icpProfileId: 'icp_1',
        requestedByUserId: 'user_1',
      }),
      {
        enqueueApolloEnrich,
        deterministicWeight: 0,
        aiWeight: 1,
      },
    );

    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        status: { in: ['new', 'processing', 'enriched', 'scored', 'qualified', 'rejected', 'stuck'] },
      },
      data: { status: 'rejected' },
    });
    expect(dbMock.prisma.leadRejection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: 'lead_1' },
      }),
    );
    expect(dbMock.prisma.leadRejection.deleteMany).not.toHaveBeenCalled();
    expect(enqueueApolloEnrich).not.toHaveBeenCalled();
  });
});
