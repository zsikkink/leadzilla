import type { CreateRetrainRunRequest, TrainingTrigger } from '@lead-flood/contracts';
import { createHash } from 'node:crypto';
import { type Prisma, prisma } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';
import { adjustDeterministicWeights, computeFactorLift } from '../scoring/lift-analysis.js';
import { splitDataset, trainLogisticRegression } from '../scoring/logistic.js';
import { TRAINED_MODEL_FEATURE_KEYS } from '../scoring/shared.js';
import {
  MODEL_EVALUATE_JOB_NAME,
  MODEL_EVALUATE_RETRY_OPTIONS,
  type ModelEvaluateJobPayload,
} from './model.evaluate.job.js';

export const MODEL_TRAIN_JOB_NAME = 'model.train';
export const MODEL_TRAIN_IDEMPOTENCY_KEY_PATTERN = 'model.train:${trainingRunId}';

export const MODEL_TRAIN_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 1,
  retryDelay: 300,
  retryBackoff: true,
  deadLetter: 'model.train.dead_letter',
};

export interface ModelTrainJobPayload
  extends Pick<
    CreateRetrainRunRequest,
    'windowDays' | 'minSamples' | 'activateIfPass' | 'requestedByUserId'
  > {
  runId: string;
  trainingRunId: string;
  trigger: TrainingTrigger;
  correlationId?: string | undefined;
}

export interface ModelTrainLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface ModelTrainJobDependencies {
  boss: Pick<PgBoss, 'send'>;
}

export const FEATURE_KEYS_FOR_TRAINING = TRAINED_MODEL_FEATURE_KEYS;

function extractFeatureVector(featuresJson: unknown): number[] | null {
  if (!featuresJson || typeof featuresJson !== 'object') return null;
  const features = featuresJson as Record<string, unknown>;

  const vector: number[] = [];
  for (const key of TRAINED_MODEL_FEATURE_KEYS) {
    const raw = features[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      vector.push(raw);
    } else if (typeof raw === 'boolean') {
      vector.push(raw ? 1 : 0);
    } else if (typeof raw === 'string') {
      const parsed = Number(raw);
      vector.push(Number.isFinite(parsed) ? parsed : 0);
    } else {
      vector.push(0);
    }
  }

  return vector;
}

function deterministicChecksum(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function extractDraftHookMetadata(
  groundingContextJson: unknown,
): { hookUsed: string | null; icpSegment: string | null } {
  if (!groundingContextJson || typeof groundingContextJson !== 'object' || Array.isArray(groundingContextJson)) {
    return { hookUsed: null, icpSegment: null };
  }

  const context = groundingContextJson as Record<string, unknown>;
  const metadata =
    context.metadata && typeof context.metadata === 'object' && !Array.isArray(context.metadata)
      ? (context.metadata as Record<string, unknown>)
      : null;

  const hookUsed = typeof metadata?.hookUsed === 'string' && metadata.hookUsed.trim().length > 0
    ? metadata.hookUsed.trim()
    : typeof context.icpHook === 'string' && context.icpHook.trim().length > 0
      ? context.icpHook.trim()
      : null;

  const icpSegment = typeof metadata?.icpSegment === 'string' && metadata.icpSegment.trim().length > 0
    ? metadata.icpSegment.trim()
    : null;

  return { hookUsed, icpSegment };
}

export async function handleModelTrainJob(
  logger: ModelTrainLogger,
  job: Job<ModelTrainJobPayload>,
  deps?: ModelTrainJobDependencies,
): Promise<void> {
  const { runId, correlationId, trainingRunId, trigger, windowDays, minSamples } = job.data;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      trainingRunId,
      correlationId: correlationId ?? job.id,
      trigger,
      windowDays,
      minSamples,
    },
    'Started model.train job',
  );

  try {
    // 1. Mark TrainingRun as RUNNING
    await prisma.trainingRun.update({
      where: { id: trainingRunId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // 2. Fetch TrainingLabel rows within the requested recency window.
    const effectiveWindowDays = Math.max(1, windowDays ?? 90);
    const labelWindowStart = new Date(Date.now() - effectiveWindowDays * 86_400_000);

    // 3. Fetch labels with each lead's latest FeatureSnapshot
    const labels = await prisma.trainingLabel.findMany({
      where: {
        createdAt: { gte: labelWindowStart },
      },
      select: {
        id: true,
        leadId: true,
        label: true,
        lead: {
          select: {
            featureSnapshots: {
              orderBy: [{ computedAt: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { featuresJson: true },
            },
          },
        },
        feedbackEvent: {
          select: {
            messageSend: {
              select: {
                messageDraft: {
                  select: {
                    groundingContextJson: true,
                    icpProfile: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const hookSummaryBySegment = new Map<
      string,
      { positive: number; negative: number; hooks: Map<string, { total: number; positive: number; negative: number }> }
    >();

    for (const entry of labels) {
      const draft = entry.feedbackEvent?.messageSend?.messageDraft;
      const metadata = extractDraftHookMetadata(draft?.groundingContextJson);

      const icpSegment = metadata.icpSegment ?? draft?.icpProfile?.name ?? 'UNKNOWN';
      const hookUsed = metadata.hookUsed ?? 'UNKNOWN';

      const segmentSummary = hookSummaryBySegment.get(icpSegment) ?? {
        positive: 0,
        negative: 0,
        hooks: new Map<string, { total: number; positive: number; negative: number }>(),
      };

      if (entry.label === 1) {
        segmentSummary.positive += 1;
      } else {
        segmentSummary.negative += 1;
      }

      const hookSummary = segmentSummary.hooks.get(hookUsed) ?? { total: 0, positive: 0, negative: 0 };
      hookSummary.total += 1;
      if (entry.label === 1) {
        hookSummary.positive += 1;
      } else {
        hookSummary.negative += 1;
      }

      segmentSummary.hooks.set(hookUsed, hookSummary);
      hookSummaryBySegment.set(icpSegment, segmentSummary);
    }

    const hookEffectivenessSummary = [...hookSummaryBySegment.entries()]
      .map(([icpSegment, summary]) => ({
        icpSegment,
        positiveCount: summary.positive,
        negativeCount: summary.negative,
        hooks: [...summary.hooks.entries()]
          .map(([hookUsed, hookSummary]) => ({
            hookUsed,
            total: hookSummary.total,
            positiveCount: hookSummary.positive,
            negativeCount: hookSummary.negative,
          }))
          .sort((a, b) => b.total - a.total),
      }))
      .sort((a, b) => b.positiveCount + b.negativeCount - (a.positiveCount + a.negativeCount));

    logger.info(
      {
        jobId: job.id,
        trainingRunId,
        segments: hookEffectivenessSummary.length,
        hookEffectivenessSummary,
      },
      'Hook effectiveness summary by ICP segment',
    );

    // 4. Build dataset: filter to labels with valid features
    const dataset: { features: number[]; label: number }[] = [];
    for (const entry of labels) {
      const snapshot = entry.lead.featureSnapshots[0];
      if (!snapshot) continue;
      const vector = extractFeatureVector(snapshot.featuresJson);
      if (!vector) continue;
      dataset.push({ features: vector, label: entry.label });
    }

    const positiveCount = dataset.filter((d) => d.label === 1).length;
    const negativeCount = dataset.filter((d) => d.label === 0).length;

    if (dataset.length < (minSamples ?? 20)) {
      logger.warn(
        {
          jobId: job.id,
          trainingRunId,
          datasetSize: dataset.length,
          minSamples: minSamples ?? 20,
        },
        'Insufficient training data, marking run as failed',
      );

      await prisma.trainingRun.update({
        where: { id: trainingRunId },
        data: {
          status: 'FAILED',
          endedAt: new Date(),
          errorMessage: `Insufficient data: ${dataset.length} samples (min: ${minSamples ?? 20})`,
          datasetSize: dataset.length,
          positiveCount,
          negativeCount,
        },
      });

      return;
    }

    // 5. Split dataset deterministically by trainingRunId
    const splits = splitDataset(dataset, trainingRunId);

    // 6. Train logistic regression on train split with class weights for imbalance
    const trainPositive = splits.train.filter((d) => d.label === 1).length;
    const trainNegative = splits.train.length - trainPositive;
    const classWeights = trainPositive > 0 && trainNegative > 0
      ? {
          positive: splits.train.length / (2 * trainPositive),
          negative: splits.train.length / (2 * trainNegative),
        }
      : undefined;

    const trainResult = trainLogisticRegression(splits.train, {
      learningRate: 0.01,
      lambda: 0.01,
      maxIterations: 1000,
      classWeights,
    });

    // 7. Create ModelVersion
    const coefficientsPayload = JSON.parse(JSON.stringify({
      keys: [...TRAINED_MODEL_FEATURE_KEYS],
      values: trainResult.coefficients,
      intercept: trainResult.intercept,
      featureStats: trainResult.featureStats,
    })) as Prisma.InputJsonValue;

    const versionTag = `lr-${trainingRunId.slice(0, 8)}-${Date.now()}`;
    const checksumSource = JSON.stringify({
      versionTag,
      coefficients: trainResult.coefficients,
      intercept: trainResult.intercept,
    });

    const modelVersion = await prisma.modelVersion.create({
      data: {
        trainingRunId,
        modelType: 'LOGISTIC_REGRESSION',
        versionTag,
        stage: 'SHADOW',
        featureSchemaJson: {
          sourceVersion: 'features_v1',
          keys: [...TRAINED_MODEL_FEATURE_KEYS],
        },
        coefficientsJson: coefficientsPayload,
        intercept: trainResult.intercept,
        deterministicWeightsJson: {},
        checksum: deterministicChecksum(checksumSource),
        trainedAt: new Date(),
      },
    });

    // 7b. Run lift analysis and store adjusted deterministic weights
    const convertedSnapshots: Record<string, unknown>[] = [];
    const nonConvertedSnapshots: Record<string, unknown>[] = [];

    for (const entry of labels) {
      const snapshot = entry.lead.featureSnapshots[0];
      if (!snapshot?.featuresJson || typeof snapshot.featuresJson !== 'object') continue;
      const features = snapshot.featuresJson as Record<string, unknown>;

      if (entry.label === 1) {
        convertedSnapshots.push(features);
      } else {
        nonConvertedSnapshots.push(features);
      }
    }

    if (convertedSnapshots.length > 0 && nonConvertedSnapshots.length > 0) {
      const liftResults = computeFactorLift(convertedSnapshots, nonConvertedSnapshots);

      // Load current deterministic weights from latest active model, or use empty defaults
      const activeModel = await prisma.modelVersion.findFirst({
        where: { stage: 'ACTIVE' },
        orderBy: { activatedAt: 'desc' },
        select: { deterministicWeightsJson: true },
      });

      const currentWeights =
        activeModel?.deterministicWeightsJson &&
        typeof activeModel.deterministicWeightsJson === 'object' &&
        !Array.isArray(activeModel.deterministicWeightsJson)
          ? (activeModel.deterministicWeightsJson as Record<string, number>)
          : {};

      if (Object.keys(currentWeights).length > 0) {
        const adjustedWeights = adjustDeterministicWeights(currentWeights, liftResults);

        await prisma.modelVersion.update({
          where: { id: modelVersion.id },
          data: {
            deterministicWeightsJson: JSON.parse(JSON.stringify(adjustedWeights)) as Prisma.InputJsonValue,
          },
        });

        logger.info(
          {
            jobId: job.id,
            trainingRunId,
            modelVersionId: modelVersion.id,
            liftFactorsAnalyzed: liftResults.length,
            weightsAdjusted: Object.keys(adjustedWeights).length,
          },
          'Lift analysis complete, deterministic weights updated on model version',
        );
      } else {
        logger.info(
          { jobId: job.id, trainingRunId },
          'No active model with deterministic weights found, skipping lift adjustment',
        );
      }
    } else {
      logger.info(
        { jobId: job.id, trainingRunId, converted: convertedSnapshots.length, nonConverted: nonConvertedSnapshots.length },
        'Insufficient cohort data for lift analysis',
      );
    }

    // 8. Update TrainingRun as SUCCEEDED
    await prisma.trainingRun.update({
      where: { id: trainingRunId },
      data: {
        status: 'SUCCEEDED',
        endedAt: new Date(),
        datasetSize: dataset.length,
        positiveCount,
        negativeCount,
      },
    });

    // 9. Enqueue model.evaluate for VALIDATION split
    if (deps?.boss) {
      const evaluatePayload: ModelEvaluateJobPayload = {
        runId: `eval-${modelVersion.id.slice(0, 8)}-${Date.now()}`,
        trainingRunId,
        modelVersionId: modelVersion.id,
        split: 'VALIDATION',
        activateIfPass: false,
        correlationId: correlationId ?? job.id,
      };

      await deps.boss.send(
        MODEL_EVALUATE_JOB_NAME,
        evaluatePayload,
        {
          ...MODEL_EVALUATE_RETRY_OPTIONS,
          singletonKey: `model.evaluate:${modelVersion.id}:VALIDATION`,
        },
      );
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        trainingRunId,
        modelVersionId: modelVersion.id,
        correlationId: correlationId ?? job.id,
        datasetSize: dataset.length,
        trainSize: splits.train.length,
        validationSize: splits.validation.length,
        testSize: splits.test.length,
        converged: trainResult.convergenceInfo.converged,
        iterations: trainResult.convergenceInfo.iterations,
      },
      'Completed model.train job',
    );
  } catch (error: unknown) {
    // Mark training run as failed
    try {
      await prisma.trainingRun.update({
        where: { id: trainingRunId },
        data: {
          status: 'FAILED',
          endedAt: new Date(),
          errorMessage: formatErrorMessage(error),
        },
      });
    } catch {
      // Swallow — we want to rethrow the original error
    }

    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        trainingRunId,
        correlationId: correlationId ?? job.id,
        error,
      },
      'Failed model.train job',
    );

    throw error;
  }
}
