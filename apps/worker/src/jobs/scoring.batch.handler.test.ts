import { randomUUID } from 'node:crypto';

import type { Job } from 'pg-boss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbMock,
  scoringMock,
  sharedMock,
  pipelineSettingsMock,
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
      icpProfile: {
        findMany: vi.fn(),
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

import {
  handleScoringBatchJob,
  type ScoringBatchJobPayload,
} from './scoring.batch.job.js';

function makeJob(data: ScoringBatchJobPayload): Job<ScoringBatchJobPayload> {
  return {
    id: randomUUID(),
    name: 'scoring.batch',
    data,
  } as Job<ScoringBatchJobPayload>;
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('handleScoringBatchJob consistency alignment', () => {
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
        status: 'new',
        phone: null,
        decisionMakerPhone: null,
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
    dbMock.prisma.leadRejection.deleteMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.leadRejection.upsert.mockResolvedValue({
      id: 'rejection_1',
    });
  });

  it('deletes stale rejection rows when a lead now qualifies', async () => {
    await handleScoringBatchJob(
      logger,
      makeJob({
        runId: 'run_1',
        icpProfileId: 'icp_1',
      }),
    );

    expect(dbMock.prisma.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'lead_1',
        status: { in: ['new', 'processing', 'enriched', 'scored', 'qualified', 'rejected', 'stuck'] },
      },
      data: { status: 'qualified' },
    });
    expect(dbMock.prisma.leadRejection.deleteMany).toHaveBeenCalledWith({
      where: { leadId: 'lead_1' },
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ qualified: 1 }),
      'Completed scoring.batch job',
    );
  });

  it('uses the trained model score as final score with deterministic as fallback only', async () => {
    sharedMock.findActiveTrainedModel.mockResolvedValue({
      model: {},
    });
    sharedMock.extractFeatureVectorForModel.mockReturnValue([]);
    scoringMock.predictLogistic.mockReturnValue(0.87);
    scoringMock.evaluateDeterministicScore.mockReturnValue({
      qualificationScore: 0.18,
      hardFilterPassed: true,
      qualificationPath: 'DISQUALIFY',
      reasonCodes: ['LOW_WEIGHTED_MATCH'],
      categoryScores: {},
      ruleEvaluation: [],
    });

    await handleScoringBatchJob(
      logger,
      makeJob({
        runId: 'run_1',
        icpProfileId: 'icp_1',
      }),
    );

    expect(dbMock.prisma.leadScorePrediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deterministicScore: 0.18,
          logisticScore: 0.87,
          blendedScore: 0.87,
          reasonsJson: expect.objectContaining({
            scoreSource: 'trained_model',
          }),
        }),
      }),
    );
    expect(scoringMock.toScoreBand).toHaveBeenCalledWith(0.87, {
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

  it('does not count hard-filter failures as qualified even when blended score is high', async () => {
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

    await handleScoringBatchJob(
      logger,
      makeJob({
        runId: 'run_1',
        icpProfileId: 'icp_1',
      }),
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
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ qualified: 0 }),
      'Completed scoring.batch job',
    );
  });

  it('preserves downstream lifecycle states on stale retries', async () => {
    dbMock.prisma.lead.updateMany.mockResolvedValue({ count: 0 });

    await handleScoringBatchJob(
      logger,
      makeJob({
        runId: 'run_1',
        icpProfileId: 'icp_1',
      }),
    );

    expect(dbMock.prisma.leadRejection.upsert).not.toHaveBeenCalled();
    expect(dbMock.prisma.leadRejection.deleteMany).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      { jobId: expect.any(String), leadId: 'lead_1' },
      'Skipped lead status update to preserve downstream lifecycle state',
    );
  });
});
