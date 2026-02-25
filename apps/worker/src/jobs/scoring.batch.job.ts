import { createHash } from 'node:crypto';
import { Prisma, prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import {
  evaluateDeterministicScore,
  toScoreBand,
  type DeterministicRule,
} from '../scoring/deterministic.js';
import { predictLogistic, type LogisticModel } from '../scoring/logistic.js';

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
  }) => Promise<void>) | undefined;
}

const DEFAULT_BATCH_SIZE = 50;
const QUALIFICATION_THRESHOLD = 0.5;

const BASELINE_MODEL_VERSION_TAG = 'deterministic-baseline-v1';
const BASELINE_FEATURE_EXTRACTOR_VERSION = 'features_v1';
const BASELINE_FEATURE_KEYS = [
  'source_provider',
  'has_email',
  'has_domain',
  'has_company_name',
  'country',
  'industry',
  'industry_supported',
  'has_whatsapp',
  'has_instagram',
  'accepts_online_payments',
  'review_count',
  'follower_count',
  'physical_address_present',
  'physical_location',
  'physical_store_present',
  'recent_activity',
  'custom_order_signals',
  'pure_self_serve_ecom',
  'shopify_detected',
  'abandonment_signal_detected',
  'multi_staff_detected',
  'follower_growth_signal',
  'high_engagement_signal',
  'has_booking_or_contact_form',
  'variable_pricing_detected',
  'industry_match',
  'industry_match_reason',
  'geo_match',
  'geo_match_reason',
  'employee_size_bucket',
  'enrichment_success_rate',
  'discovery_attempt_count',
  'enrichment_attempt_count',
  'days_since_discovery',
  'rule_match_count',
  'hard_filter_passed',
] as const;

const BASELINE_TRAINING_RUN_TRIGGER = 'MANUAL';

/** Feature keys used by the trained logistic model (must match model.train NUMERIC_FEATURE_KEYS). */
const TRAINED_MODEL_FEATURE_KEYS = [
  'has_email',
  'has_domain',
  'has_company_name',
  'industry_supported',
  'has_whatsapp',
  'has_instagram',
  'accepts_online_payments',
  'review_count',
  'follower_count',
  'physical_address_present',
  'physical_store_present',
  'recent_activity',
  'custom_order_signals',
  'pure_self_serve_ecom',
  'shopify_detected',
  'abandonment_signal_detected',
  'multi_staff_detected',
  'follower_growth_signal',
  'high_engagement_signal',
  'has_booking_or_contact_form',
  'variable_pricing_detected',
  'industry_match',
  'geo_match',
  'enrichment_success_rate',
  'discovery_attempt_count',
  'enrichment_attempt_count',
  'days_since_discovery',
  'rule_match_count',
  'hard_filter_passed',
] as const;

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function deterministicChecksum(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function asDeterministicRules(
  value: Awaited<ReturnType<typeof prisma.qualificationRule.findMany>>,
): DeterministicRule[] {
  return value.map((rule) => ({
    id: rule.id,
    name: rule.name,
    ruleType: rule.ruleType,
    isRequired: rule.isRequired,
    fieldKey: rule.fieldKey,
    operator: rule.operator,
    valueJson: rule.valueJson,
    weight: rule.weight,
    isActive: rule.isActive,
    orderIndex: rule.orderIndex,
    priority: rule.priority,
  }));
}

function extractFeatureVectorForModel(featuresJson: Record<string, unknown>): number[] {
  const vector: number[] = [];
  for (const key of TRAINED_MODEL_FEATURE_KEYS) {
    const raw = featuresJson[key];
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

function parseTrainedModel(coefficientsJson: unknown): LogisticModel | null {
  if (!coefficientsJson || typeof coefficientsJson !== 'object') return null;
  const payload = coefficientsJson as Record<string, unknown>;
  const values = payload['values'];
  const intercept = payload['intercept'];
  const featureStats = payload['featureStats'];
  if (!Array.isArray(values) || typeof intercept !== 'number' || !Array.isArray(featureStats)) {
    return null;
  }
  return {
    coefficients: values as number[],
    intercept,
    featureStats: featureStats as { mean: number; std: number }[],
  };
}

async function findActiveTrainedModel(): Promise<{ id: string; model: LogisticModel } | null> {
  const active = await prisma.modelVersion.findFirst({
    where: {
      stage: 'ACTIVE',
      modelType: 'LOGISTIC_REGRESSION',
      versionTag: { not: BASELINE_MODEL_VERSION_TAG },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, coefficientsJson: true },
  });
  if (!active) return null;

  const model = parseTrainedModel(active.coefficientsJson);
  if (!model) return null;

  return { id: active.id, model };
}

async function ensureBaselineModelVersion(): Promise<string> {
  const existing = await prisma.modelVersion.findUnique({
    where: { versionTag: BASELINE_MODEL_VERSION_TAG },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }

  const now = new Date();
  const checksumSource = JSON.stringify({
    versionTag: BASELINE_MODEL_VERSION_TAG,
    sourceVersion: BASELINE_FEATURE_EXTRACTOR_VERSION,
    featureKeys: BASELINE_FEATURE_KEYS,
  });

  try {
    const created = await prisma.$transaction(async (tx) => {
      const trainingRun = await tx.trainingRun.create({
        data: {
          modelType: 'LOGISTIC_REGRESSION',
          status: 'SUCCEEDED',
          trigger: BASELINE_TRAINING_RUN_TRIGGER,
          configJson: {
            baseline: true,
            sourceVersion: BASELINE_FEATURE_EXTRACTOR_VERSION,
          },
          trainingWindowStart: new Date(now.getTime() - 86_400_000),
          trainingWindowEnd: now,
          datasetSize: 0,
          positiveCount: 0,
          negativeCount: 0,
          startedAt: now,
          endedAt: now,
        },
      });

      return tx.modelVersion.create({
        data: {
          trainingRunId: trainingRun.id,
          modelType: 'LOGISTIC_REGRESSION',
          versionTag: BASELINE_MODEL_VERSION_TAG,
          stage: 'ACTIVE',
          featureSchemaJson: {
            sourceVersion: BASELINE_FEATURE_EXTRACTOR_VERSION,
            keys: BASELINE_FEATURE_KEYS,
          },
          coefficientsJson: Prisma.JsonNull,
          intercept: 0,
          deterministicWeightsJson: {},
          checksum: deterministicChecksum(checksumSource),
          trainedAt: now,
          activatedAt: now,
        },
      });
    });

    return created.id;
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const fallback = await prisma.modelVersion.findUnique({
        where: { versionTag: BASELINE_MODEL_VERSION_TAG },
        select: { id: true },
      });
      if (fallback) {
        return fallback.id;
      }
    }
    throw error;
  }
}

const DEFAULT_DETERMINISTIC_WEIGHT = 0.6;
const DEFAULT_AI_WEIGHT = 0.4;

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
        featureSnapshots: { some: {} },
        scorePredictions: { none: {} },
        status: { in: ['enriched', 'new'] },
      },
      take: effectiveBatchSize,
      select: {
        id: true,
        status: true,
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

        // Evaluate deterministic score
        const rules = rulesByIcp.get(targetIcpId) ?? [];
        const deterministic = evaluateDeterministicScore(rules, featurePayload);
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
          logisticScore > 0
            ? DEFAULT_DETERMINISTIC_WEIGHT * deterministicScore +
              DEFAULT_AI_WEIGHT * logisticScore
            : deterministicScore;
        const scoreBand = toScoreBand(blendedScore);

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
              usedTrainedModel,
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
              usedTrainedModel,
            }),
            ruleEvaluationJson: toInputJson(deterministic.ruleEvaluation),
            predictedAt: new Date(),
          },
        });

        scored += 1;

        // Enqueue message generation for qualified leads
        if (blendedScore >= QUALIFICATION_THRESHOLD && deps?.enqueueMessageGenerate) {
          try {
            await deps.enqueueMessageGenerate({
              leadId: lead.id,
              icpProfileId: targetIcpId,
              scorePredictionId: prediction.id,
            });
            qualified += 1;
          } catch (enqueueError: unknown) {
            logger.warn(
              {
                jobId: job.id,
                leadId: lead.id,
                icpProfileId: targetIcpId,
                scorePredictionId: prediction.id,
                error: enqueueError,
              },
              'Failed to enqueue message.generate for qualified lead',
            );
          }
        } else if (blendedScore >= QUALIFICATION_THRESHOLD) {
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

    throw error;
  }
}
