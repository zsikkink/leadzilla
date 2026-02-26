import { prisma } from '@lead-flood/db';
import type { LogisticModel } from './logistic.js';

export const BASELINE_MODEL_VERSION_TAG = 'deterministic-baseline-v1';
export const QUALIFICATION_THRESHOLD = 0.5;

/**
 * Feature keys consumed by the trained logistic regression model.
 * Must stay in sync with model.train NUMERIC_FEATURE_KEYS.
 *
 * 27 features: 20 original (noise removed) + 7 Wave-1 additions.
 */
export const TRAINED_MODEL_FEATURE_KEYS = [
  // ── Original 20 (noise features removed) ──
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
  // ── Wave-1 additions (7) ──
  'high_ticket_signals',
  'deposit_milestone_signals',
  'subscription_billing_detected',
  'international_customer_signals',
  'icp_segment_priority',
  'review_count_tier',
  'follower_count_tier',
] as const;

/**
 * Extract a numeric feature vector aligned to TRAINED_MODEL_FEATURE_KEYS
 * from a raw featuresJson record (as stored in LeadFeatureSnapshot).
 */
export function extractFeatureVectorForModel(featuresJson: Record<string, unknown>): number[] {
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

/**
 * Parse a stored coefficientsJson blob into a LogisticModel, or return null
 * if the shape is invalid (e.g. the baseline stub which has JsonNull).
 */
export function parseTrainedModel(coefficientsJson: unknown): LogisticModel | null {
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

/**
 * Find the most recent ACTIVE trained logistic model (excluding the
 * deterministic baseline stub).
 */
export async function findActiveTrainedModel(): Promise<{ id: string; model: LogisticModel } | null> {
  const active = await prisma.modelVersion.findFirst({
    where: {
      stage: 'ACTIVE',
      modelType: 'LOGISTIC_REGRESSION',
      // Exclude the baseline version — it has no real coefficients
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

/**
 * Compute the deterministic / AI blend ratio dynamically based on trained
 * model maturity (AUC + dataset size).
 *
 * Tiers:
 *  - Default (no model or poor metrics):  90% deterministic / 10% ML
 *  - AUC >= 0.70 with 200+ samples:       70% deterministic / 30% ML
 *  - AUC >= 0.80 with 500+ samples:       50% deterministic / 50% ML
 */
export async function computeBlendRatio(
  _logger?: { info: (obj: Record<string, unknown>, msg: string) => void } | undefined,
): Promise<{ deterministicWeight: number; aiWeight: number }> {
  // Find the latest ModelEvaluation for the active model on the TEST split
  const latestEval = await prisma.modelEvaluation.findFirst({
    where: {
      split: 'TEST',
      modelVersion: {
        stage: 'ACTIVE',
        modelType: 'LOGISTIC_REGRESSION',
        versionTag: { not: BASELINE_MODEL_VERSION_TAG },
      },
    },
    orderBy: { evaluatedAt: 'desc' },
    select: {
      auc: true,
      sampleSize: true,
      modelVersion: {
        select: {
          trainingRun: {
            select: { datasetSize: true },
          },
        },
      },
    },
  });

  if (!latestEval) {
    return { deterministicWeight: 0.9, aiWeight: 0.1 };
  }

  const auc = latestEval.auc;
  const datasetSize = latestEval.modelVersion?.trainingRun?.datasetSize ?? 0;

  if (auc >= 0.80 && datasetSize >= 500) {
    return { deterministicWeight: 0.5, aiWeight: 0.5 };
  }
  if (auc >= 0.70 && datasetSize >= 200) {
    return { deterministicWeight: 0.7, aiWeight: 0.3 };
  }

  return { deterministicWeight: 0.9, aiWeight: 0.1 };
}
