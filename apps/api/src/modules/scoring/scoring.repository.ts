import { randomUUID } from 'node:crypto';

import type {
  CreateScoringRunRequest,
  CreateScoringRunResponse,
  LatestLeadDeterministicScoreResponse,
  LatestLeadFeatureSnapshotResponse,
  LatestLeadScoreResponse,
  LatestLeadScoreQuery,
  ListScorePredictionsQuery,
  ListScorePredictionsResponse,
  PipelineRunStatus,
  QualificationRuleResponse,
  QualificationRuleType,
  QualificationOperator,
  ScoringRunStatusResponse,
} from '@lead-flood/contracts';
import { prisma, toInputJson } from '@lead-flood/db';

import { ScoringNotImplementedError, ScoringRunNotFoundError } from './scoring.errors.js';

type CreateScoringRunInput = CreateScoringRunRequest & {
  requestedByUserId?: string | undefined;
};

export interface CreateScoringRuleInput {
  icpProfileId: string;
  fieldKey: string;
  operator: QualificationOperator;
  valueJson?: unknown | undefined;
  weight: number;
  ruleType: QualificationRuleType;
  name: string;
}

const SCORING_RUN_JOB_TYPE = 'scoring.compute';

interface ScoringRunProgress {
  totalItems: number;
  processedItems: number;
  failedItems: number;
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  return 0;
}

function readRunProgress(result: unknown): ScoringRunProgress {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      totalItems: 0,
      processedItems: 0,
      failedItems: 0,
    };
  }

  const payload = result as Record<string, unknown>;
  return {
    totalItems: toCount(payload.totalItems),
    processedItems: toCount(payload.processedItems),
    failedItems: toCount(payload.failedItems),
  };
}

function mapJobStatusToPipelineStatus(
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
  failedItems: number,
): PipelineRunStatus {
  switch (status) {
    case 'queued':
      return 'QUEUED';
    case 'running':
      return 'RUNNING';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    case 'completed':
    default:
      return failedItems > 0 ? 'PARTIAL' : 'SUCCEEDED';
  }
}

export interface ScoringRepository {
  createScoringRun(input: CreateScoringRunInput): Promise<CreateScoringRunResult>;
  markScoringRunFailed(runId: string, errorMessage: string): Promise<void>;
  getScoringRunStatus(runId: string): Promise<ScoringRunStatusResponse>;
  listScorePredictions(query: ListScorePredictionsQuery): Promise<ListScorePredictionsResponse>;
  getLatestLeadScore(leadId: string, query: LatestLeadScoreQuery): Promise<LatestLeadScoreResponse>;
  getLatestLeadFeatureSnapshot(
    leadId: string,
    query: LatestLeadScoreQuery,
  ): Promise<LatestLeadFeatureSnapshotResponse>;
  getLatestLeadDeterministicScore(
    leadId: string,
    query: LatestLeadScoreQuery,
  ): Promise<LatestLeadDeterministicScoreResponse>;
  createQualificationRule(input: CreateScoringRuleInput): Promise<QualificationRuleResponse>;
}

export interface CreateScoringRunResult extends CreateScoringRunResponse {
  outboxEventId: string;
}

export class StubScoringRepository implements ScoringRepository {
  async createScoringRun(_input: CreateScoringRunInput): Promise<CreateScoringRunResult> {
    throw new ScoringNotImplementedError('TODO: create scoring run persistence');
  }

  async markScoringRunFailed(_runId: string, _errorMessage: string): Promise<void> {
    throw new ScoringNotImplementedError('TODO: mark scoring run failed persistence');
  }

  async getScoringRunStatus(_runId: string): Promise<ScoringRunStatusResponse> {
    throw new ScoringNotImplementedError('TODO: get scoring run status persistence');
  }

  async listScorePredictions(_query: ListScorePredictionsQuery): Promise<ListScorePredictionsResponse> {
    throw new ScoringNotImplementedError('TODO: list score predictions persistence');
  }

  async getLatestLeadScore(_leadId: string, _query: LatestLeadScoreQuery): Promise<LatestLeadScoreResponse> {
    throw new ScoringNotImplementedError('TODO: get latest lead score persistence');
  }

  async getLatestLeadFeatureSnapshot(
    _leadId: string,
    _query: LatestLeadScoreQuery,
  ): Promise<LatestLeadFeatureSnapshotResponse> {
    throw new ScoringNotImplementedError('TODO: get latest lead feature snapshot persistence');
  }

  async getLatestLeadDeterministicScore(
    _leadId: string,
    _query: LatestLeadScoreQuery,
  ): Promise<LatestLeadDeterministicScoreResponse> {
    throw new ScoringNotImplementedError('TODO: get latest lead deterministic score persistence');
  }

  async createQualificationRule(_input: CreateScoringRuleInput): Promise<QualificationRuleResponse> {
    throw new ScoringNotImplementedError('TODO: create qualification rule persistence');
  }
}

export class PrismaScoringRepository extends StubScoringRepository {
  override async createScoringRun(input: CreateScoringRunInput): Promise<CreateScoringRunResult> {
    const runId = randomUUID();
    const queuePayload = {
      runId,
      mode: input.mode,
      icpProfileId: input.icpProfileId,
      leadIds: input.leadIds,
      modelVersionId: input.modelVersionId,
      requestedByUserId: input.requestedByUserId,
    };

    const { outboxEvent } = await prisma.$transaction(async (tx) => {
      await tx.jobExecution.create({
        data: {
          id: runId,
          type: SCORING_RUN_JOB_TYPE,
          status: 'queued',
          attempts: 0,
          payload: toInputJson(input),
          result: toInputJson({
            totalItems: 0,
            processedItems: 0,
            failedItems: 0,
          }),
          error: null,
        },
      });

      const outboxEvent = await tx.outboxEvent.create({
        data: {
          type: SCORING_RUN_JOB_TYPE,
          payload: toInputJson(queuePayload),
          status: 'pending',
        },
      });

      return { outboxEvent };
    });

    return { runId, status: 'QUEUED', outboxEventId: outboxEvent.id };
  }

  override async markScoringRunFailed(runId: string, errorMessage: string): Promise<void> {
    await prisma.jobExecution.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: errorMessage,
        finishedAt: new Date(),
      },
    });
  }

  override async getScoringRunStatus(runId: string): Promise<ScoringRunStatusResponse> {
    const run = await prisma.jobExecution.findFirst({
      where: {
        id: runId,
        type: SCORING_RUN_JOB_TYPE,
      },
    });

    if (!run) {
      throw new ScoringRunNotFoundError();
    }

    const progress = readRunProgress(run.result);
    const status = mapJobStatusToPipelineStatus(run.status, progress.failedItems);

    return {
      runId: run.id,
      runType: 'SCORING',
      status,
      totalItems: progress.totalItems,
      processedItems: progress.processedItems,
      failedItems: progress.failedItems,
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.finishedAt?.toISOString() ?? null,
      errorMessage: run.error,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  }

  override async listScorePredictions(query: ListScorePredictionsQuery): Promise<ListScorePredictionsResponse> {
    const where = {
      ...(query.leadId ? { leadId: query.leadId } : {}),
      ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
      ...(query.modelVersionId ? { modelVersionId: query.modelVersionId } : {}),
      ...(query.scoreBand ? { scoreBand: query.scoreBand } : {}),
      ...(query.minBlendedScore !== undefined || query.maxBlendedScore !== undefined
        ? {
            blendedScore: {
              ...(query.minBlendedScore !== undefined ? { gte: query.minBlendedScore } : {}),
              ...(query.maxBlendedScore !== undefined ? { lte: query.maxBlendedScore } : {}),
            },
          }
        : {}),
      ...(query.from || query.to
        ? {
            predictedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.leadScorePrediction.count({ where }),
      prisma.leadScorePrediction.findMany({
        where,
        orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        icpProfileId: row.icpProfileId,
        featureSnapshotId: row.featureSnapshotId,
        modelVersionId: row.modelVersionId,
        deterministicScore: row.deterministicScore,
        logisticScore: row.logisticScore,
        blendedScore: row.blendedScore,
        scoreBand: row.scoreBand,
        reasonsJson: row.reasonsJson,
        predictedAt: row.predictedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  override async getLatestLeadScore(leadId: string, query: LatestLeadScoreQuery): Promise<LatestLeadScoreResponse> {
    const prediction = await prisma.leadScorePrediction.findFirst({
      where: {
        leadId,
        ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
      },
      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      leadId,
      prediction: prediction
        ? {
            id: prediction.id,
            leadId: prediction.leadId,
            icpProfileId: prediction.icpProfileId,
            featureSnapshotId: prediction.featureSnapshotId,
            modelVersionId: prediction.modelVersionId,
            deterministicScore: prediction.deterministicScore,
            logisticScore: prediction.logisticScore,
            blendedScore: prediction.blendedScore,
            scoreBand: prediction.scoreBand,
            reasonsJson: prediction.reasonsJson,
            predictedAt: prediction.predictedAt.toISOString(),
            createdAt: prediction.createdAt.toISOString(),
          }
        : null,
    };
  }

  override async getLatestLeadFeatureSnapshot(
    leadId: string,
    query: LatestLeadScoreQuery,
  ): Promise<LatestLeadFeatureSnapshotResponse> {
    const snapshot = await prisma.leadFeatureSnapshot.findFirst({
      where: {
        leadId,
        ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
      },
      orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });

    return {
      leadId,
      icpProfileId: query.icpProfileId ?? null,
      snapshot: snapshot
        ? {
            id: snapshot.id,
            leadId: snapshot.leadId,
            icpProfileId: snapshot.icpProfileId,
            discoveryRecordId: snapshot.discoveryRecordId ?? null,
            enrichmentRecordId: snapshot.enrichmentRecordId ?? null,
            snapshotVersion: snapshot.snapshotVersion,
            sourceVersion: snapshot.sourceVersion,
            featureVectorHash: snapshot.featureVectorHash,
            featuresJson: snapshot.featuresJson,
            ruleMatchCount: snapshot.ruleMatchCount,
            hardFilterPassed: snapshot.hardFilterPassed,
            computedAt: snapshot.computedAt.toISOString(),
            createdAt: snapshot.createdAt.toISOString(),
          }
        : null,
    };
  }

  override async getLatestLeadDeterministicScore(
    leadId: string,
    query: LatestLeadScoreQuery,
  ): Promise<LatestLeadDeterministicScoreResponse> {
    const prediction = await prisma.leadScorePrediction.findFirst({
      where: {
        leadId,
        ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
      },
      orderBy: [{ predictedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const reasonsJson =
      prediction?.reasonsJson && typeof prediction.reasonsJson === 'object'
        ? (prediction.reasonsJson as Record<string, unknown>)
        : {};
    const reasonCodes = Array.isArray(reasonsJson.reasonCodes)
      ? reasonsJson.reasonCodes.filter((value): value is string => typeof value === 'string')
      : [];
    const ruleEvaluation = Array.isArray(prediction?.ruleEvaluationJson)
      ? prediction.ruleEvaluationJson
      : [];

    return {
      leadId,
      icpProfileId: query.icpProfileId ?? null,
      predictionId: prediction?.id ?? null,
      deterministicScore: prediction?.deterministicScore ?? null,
      reasonCodes,
      ruleEvaluation,
      predictedAt: prediction?.predictedAt.toISOString() ?? null,
    };
  }

  override async createQualificationRule(input: CreateScoringRuleInput): Promise<QualificationRuleResponse> {
    // Get the max orderIndex for this ICP to place the new rule at the end
    const maxOrder = await prisma.qualificationRule.aggregate({
      where: { icpProfileId: input.icpProfileId },
      _max: { orderIndex: true },
    });
    const nextOrderIndex = (maxOrder._max.orderIndex ?? 0) + 1;

    const rule = await prisma.qualificationRule.create({
      data: {
        icpProfileId: input.icpProfileId,
        name: input.name,
        ruleType: input.ruleType,
        fieldKey: input.fieldKey,
        operator: input.operator,
        valueJson: toInputJson(input.valueJson),
        weight: input.weight,
        orderIndex: nextOrderIndex,
        isActive: true,
      },
    });

    return {
      id: rule.id,
      icpProfileId: rule.icpProfileId,
      name: rule.name,
      ruleType: rule.ruleType,
      fieldKey: rule.fieldKey,
      operator: rule.operator,
      valueJson: rule.valueJson,
      weight: rule.weight,
      isRequired: rule.isRequired,
      priority: rule.priority,
      orderIndex: rule.orderIndex,
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    };
  }
}
