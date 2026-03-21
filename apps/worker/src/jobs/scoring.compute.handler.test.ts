import { randomUUID } from 'node:crypto';

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
    dbMock.prisma.jobExecution.updateMany.mockResolvedValue({ count: 1 });
    trackerMock.tryFinalizeDiscoveryRun.mockResolvedValue(undefined);
  });

  it('loads BusinessConversion only from the lead primary business context before enqueueing Apollo enrich', async () => {
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
  });
});
