import { prisma, toInputJson } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { classifyError } from '../errors.js';
import {
  evaluateDeterministicScore,
  toScoreBand,
  type DeterministicRule,
} from '../scoring/deterministic.js';
import { predictLogistic } from '../scoring/logistic.js';
import {
  asDeterministicRules,
  computeBlendRatio,
  ensureBaselineModelVersion,
  extractFeatureVectorForModel,
  findActiveTrainedModel,
  getQualificationThreshold,
} from '../scoring/shared.js';
import { getDeterministicAiBlend, getScoreTierBands } from '../utils/pipeline-settings.js';

export const SCORING_BATCH_JOB_NAME = 'scoring.batch';

export const SCORING_BATCH_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'scoring.batch.dead_letter',
};

export interface ScoringBatchJobPayload {
  runId: string;
  batchSize?: number | undefined;
  icpProfileId?: string | undefined;
  correlationId?: string | undefined;
}

export interface ScoringBatchLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface ScoringBatchJobDependencies {
  enqueueMessageGenerate?: ((payload: {
    leadId: string;
    icpProfileId: string;
    scorePredictionId: string;
    channel?: string | undefined;
  }) => Promise<void>) | undefined;
}

const DEFAULT_BATCH_SIZE = 50;


export async function handleScoringBatchJob(
  logger: ScoringBatchLogger,
  job: Job<ScoringBatchJobPayload>,
  deps?: ScoringBatchJobDependencies,
): Promise<void> {
  const { runId, correlationId, batchSize: requestedBatchSize, icpProfileId } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;
  const effectiveBatchSize = requestedBatchSize ?? DEFAULT_BATCH_SIZE;
  const startTime = Date.now();

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: effectiveCorrelationId,
      batchSize: effectiveBatchSize,
      icpProfileId,
    },
    'Started scoring.batch job',
  );

  try {
    // Find leads that have feature snapshots but no score predictions
    const unscoredLeads = await prisma.lead.findMany({
      where: {
        deletedAt: null,
        featureSnapshots: { some: {} },
        scorePredictions: { none: {} },
        status: { in: ['new', 'processing'] },
      },
      take: effectiveBatchSize,
      select: {
        id: true,
        status: true,
        phone: true,
        decisionMakerPhone: true,
      },
    });

    if (unscoredLeads.length === 0) {
      logger.info(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          correlationId: effectiveCorrelationId,
        },
        'No unscored leads found, skipping batch',
      );
      return;
    }

    // Resolve target ICP profiles
    const targetIcpIds = icpProfileId
      ? [icpProfileId]
      : (
          await prisma.icpProfile.findMany({
            where: { isActive: true },
            select: { id: true },
          })
        ).map((row) => row.id);

    if (targetIcpIds.length === 0) {
      logger.warn(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          correlationId: effectiveCorrelationId,
        },
        'No active ICP profiles found, skipping batch',
      );
      return;
    }

    // Pre-load qualification rules per ICP
    const rulesByIcp = new Map<string, DeterministicRule[]>();
    for (const icpId of targetIcpIds) {
      const rules = await prisma.qualificationRule.findMany({
        where: {
          icpProfileId: icpId,
          isActive: true,
        },
        orderBy: [{ orderIndex: 'asc' }, { priority: 'asc' }, { createdAt: 'asc' }],
      });
      rulesByIcp.set(icpId, asDeterministicRules(rules));
    }

    // Ensure baseline model version exists and find active trained model
    const effectiveModelVersionId = await ensureBaselineModelVersion();
    const trainedModel = await findActiveTrainedModel();
    const qualificationThreshold = await getQualificationThreshold();

    // Read UI-configured blend override and tier bands
    const deterministicAiBlend = await getDeterministicAiBlend();
    const blendRatio = deterministicAiBlend !== null
      ? { deterministicWeight: deterministicAiBlend, aiWeight: 1 - deterministicAiBlend }
      : await computeBlendRatio();
    const scoreTierBands = await getScoreTierBands();

    let scored = 0;
    let qualified = 0;
    let skipped = 0;

    for (const lead of unscoredLeads) {
      for (const targetIcpId of targetIcpIds) {
        // Get latest feature snapshot for this lead+ICP pair
        const latestSnapshot = await prisma.leadFeatureSnapshot.findFirst({
          where: {
            leadId: lead.id,
            icpProfileId: targetIcpId,
          },
          orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        });

        if (!latestSnapshot) {
          skipped += 1;
          continue;
        }

        const featurePayload =
          latestSnapshot.featuresJson && typeof latestSnapshot.featuresJson === 'object'
            ? (latestSnapshot.featuresJson as Record<string, unknown>)
            : {};

        // Data alignment hard filter: override scoring when cross-source data mismatch is severe
        const dataAlignmentScore = typeof featurePayload.data_alignment_score === 'number'
          ? featurePayload.data_alignment_score
          : null;
        const dataAlignmentFailed = dataAlignmentScore !== null && dataAlignmentScore < 0.3;

        // Evaluate deterministic score
        const rules = rulesByIcp.get(targetIcpId) ?? [];
        const deterministic = evaluateDeterministicScore(rules, featurePayload);

        if (dataAlignmentFailed) {
          deterministic.hardFilterPassed = false;
          deterministic.qualificationScore = 0;
          deterministic.qualificationPath = 'HARD_FILTERED';
          deterministic.reasonCodes.push('HARD_FILTER_FAILED_DATA_ALIGNMENT_SCORE');
        }

        const deterministicScore = deterministic.qualificationScore;

        // Evaluate logistic model score if available
        let logisticScore = 0;
        let usedTrainedModel = false;

        if (trainedModel) {
          const featureVector = extractFeatureVectorForModel(featurePayload);
          logisticScore = predictLogistic(featureVector, trainedModel.model);
          usedTrainedModel = true;
        }

        // Blend scores
        const blendedScore =
          usedTrainedModel || logisticScore > 0
            ? blendRatio.deterministicWeight * deterministicScore +
              blendRatio.aiWeight * logisticScore
            : deterministicScore;
        const scoreBand = toScoreBand(blendedScore, scoreTierBands);

        // Persist prediction
        const prediction = await prisma.leadScorePrediction.upsert({
          where: {
            leadId_icpProfileId_featureSnapshotId_modelVersionId: {
              leadId: lead.id,
              icpProfileId: targetIcpId,
              featureSnapshotId: latestSnapshot.id,
              modelVersionId: effectiveModelVersionId,
            },
          },
          create: {
            leadId: lead.id,
            icpProfileId: targetIcpId,
            featureSnapshotId: latestSnapshot.id,
            modelVersionId: effectiveModelVersionId,
            deterministicScore,
            logisticScore,
            blendedScore,
            scoreBand,
            reasonsJson: toInputJson({
              reasonCodes: deterministic.reasonCodes,
              hardFilterPassed: deterministic.hardFilterPassed,
              categoryScores: deterministic.categoryScores,
              qualificationPath: deterministic.qualificationPath,
              usedTrainedModel,
              blendWeights: { deterministic: blendRatio.deterministicWeight, ai: blendRatio.aiWeight },
            }),
            ruleEvaluationJson: toInputJson(deterministic.ruleEvaluation),
            predictedAt: new Date(),
          },
          update: {
            deterministicScore,
            logisticScore,
            blendedScore,
            scoreBand,
            reasonsJson: toInputJson({
              reasonCodes: deterministic.reasonCodes,
              hardFilterPassed: deterministic.hardFilterPassed,
              categoryScores: deterministic.categoryScores,
              qualificationPath: deterministic.qualificationPath,
              usedTrainedModel,
              blendWeights: { deterministic: blendRatio.deterministicWeight, ai: blendRatio.aiWeight },
            }),
            ruleEvaluationJson: toInputJson(deterministic.ruleEvaluation),
            predictedAt: new Date(),
          },
        });

        scored += 1;

        // Transition lead to enriched now that it has a score
        await prisma.lead.update({ where: { id: lead.id }, data: { status: 'enriched' } });

        // Enqueue message generation for qualified leads
        if (blendedScore >= qualificationThreshold && deps?.enqueueMessageGenerate) {
          const hasPhone = Boolean(lead.decisionMakerPhone || lead.phone);
          const channel = blendedScore >= 0.67 && hasPhone ? 'WHATSAPP' : 'EMAIL';
          await deps.enqueueMessageGenerate({
            leadId: lead.id,
            icpProfileId: targetIcpId,
            scorePredictionId: prediction.id,
            channel,
          });
          qualified += 1;
        } else if (blendedScore >= qualificationThreshold) {
          qualified += 1;
        }
      }
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        batchSize: effectiveBatchSize,
        scored,
        qualified,
        skipped,
        duration,
      },
      'Completed scoring.batch job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        error,
      },
      'Failed scoring.batch job',
    );

    throw classifyError(error);
  }
}
