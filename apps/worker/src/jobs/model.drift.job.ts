import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';
import { TRAINED_MODEL_FEATURE_KEYS } from '../scoring/shared.js';
import { computePopulationRates, detectFeatureDrift } from '../utils/feature-drift.js';

export const MODEL_DRIFT_JOB_NAME = 'model.drift';

export const MODEL_DRIFT_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
  deadLetter: 'model.drift.dead_letter',
};

/** Number of recent snapshots to compare against training data. */
const RECENT_SNAPSHOT_LIMIT = 500;

/** Number of historical snapshots (training window). */
const HISTORICAL_SNAPSHOT_LIMIT = 1000;

/** Minimum previous rate to consider a feature as "expected to be populated". */
const DRIFT_THRESHOLD = 0.3;

/** Number of drifted features that triggers a retraining recommendation. */
const DRIFT_ALERT_THRESHOLD = 3;

export interface ModelDriftJobPayload {
  correlationId?: string | undefined;
}

export interface ModelDriftLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface ModelDriftJobDependencies {
  slackWebhookUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  enqueueModelTrain?: ((payload: unknown) => Promise<void>) | undefined;
}

export async function handleModelDriftJob(
  logger: ModelDriftLogger,
  job: Job<ModelDriftJobPayload>,
  deps?: ModelDriftJobDependencies,
): Promise<void> {
  logger.info(
    { jobId: job.id, queue: job.name },
    'Started model.drift detection',
  );

  try {
    // 1. Find the latest active model to determine the training window
    const activeModel = await prisma.modelVersion.findFirst({
      where: { stage: 'ACTIVE' },
      orderBy: { activatedAt: 'desc' },
      select: { id: true, trainedAt: true, activatedAt: true },
    });

    if (!activeModel) {
      logger.info({ jobId: job.id }, 'No active model found, skipping drift detection');
      return;
    }

    // 2. Fetch historical snapshots (around training time)
    const trainedAt = activeModel.trainedAt ?? activeModel.activatedAt ?? new Date();
    const historicalSnapshots = await prisma.leadFeatureSnapshot.findMany({
      where: {
        computedAt: { lte: trainedAt },
      },
      select: { featuresJson: true },
      orderBy: { computedAt: 'desc' },
      take: HISTORICAL_SNAPSHOT_LIMIT,
    });

    if (historicalSnapshots.length < 50) {
      logger.info(
        { jobId: job.id, count: historicalSnapshots.length },
        'Insufficient historical snapshots for drift detection',
      );
      return;
    }

    // 3. Fetch recent snapshots (last 7 days)
    const recentCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentSnapshots = await prisma.leadFeatureSnapshot.findMany({
      where: {
        computedAt: { gte: recentCutoff },
      },
      select: { featuresJson: true },
      orderBy: { computedAt: 'desc' },
      take: RECENT_SNAPSHOT_LIMIT,
    });

    if (recentSnapshots.length < 20) {
      logger.info(
        { jobId: job.id, count: recentSnapshots.length },
        'Insufficient recent snapshots for drift detection',
      );
      return;
    }

    // 4. Compute population rates
    const historicalRates = computePopulationRates(
      historicalSnapshots.map((s) => s.featuresJson as Record<string, unknown>),
      TRAINED_MODEL_FEATURE_KEYS,
    );

    const recentRates = computePopulationRates(
      recentSnapshots.map((s) => s.featuresJson as Record<string, unknown>),
      TRAINED_MODEL_FEATURE_KEYS,
    );

    // 5. Detect drift
    const driftResults = detectFeatureDrift(historicalRates, recentRates, DRIFT_THRESHOLD);

    logger.info(
      {
        jobId: job.id,
        historicalCount: historicalSnapshots.length,
        recentCount: recentSnapshots.length,
        driftedFeatureCount: driftResults.length,
        driftedFeatures: driftResults.map((d) => d.feature),
      },
      'Feature drift analysis complete',
    );

    // 6. Alert if significant drift detected
    if (driftResults.length >= DRIFT_ALERT_THRESHOLD) {
      const driftSummary = driftResults
        .map((d) => `  ${d.feature}: ${(d.previousRate * 100).toFixed(1)}% → ${(d.currentRate * 100).toFixed(1)}%`)
        .join('\n');

      logger.warn(
        {
          jobId: job.id,
          driftedFeatureCount: driftResults.length,
          threshold: DRIFT_ALERT_THRESHOLD,
        },
        `Feature drift detected: ${driftResults.length} features dropped to 0%`,
      );

      // Send Slack alert
      const fetchFn = deps?.fetchImpl ?? globalThis.fetch;
      if (deps?.slackWebhookUrl) {
        try {
          await fetchFn(deps.slackWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: `Feature drift detected: ${driftResults.length} features dropped to 0% population\n\`\`\`\n${driftSummary}\n\`\`\`\nConsider retraining the model.`,
            }),
          });
        } catch {
          // Slack is best-effort
        }
      }
    }
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, error: formatErrorMessage(error) },
      'Model drift detection failed',
    );
    // Terminal job — don't throw
  }
}
