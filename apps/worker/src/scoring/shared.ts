import { createHash } from 'node:crypto';
import { Prisma, prisma } from '@lead-flood/db';
import type { DeterministicRule } from './deterministic.js';
import type { LogisticModel } from './logistic.js';

export const BASELINE_MODEL_VERSION_TAG = 'deterministic-baseline-v1';

const DEFAULT_QUALIFICATION_THRESHOLD = 0.34;

/**
 * Read the qualification threshold from PipelineSetting table.
 * Falls back to DEFAULT_QUALIFICATION_THRESHOLD (0.34) if not set.
 */
export async function getQualificationThreshold(): Promise<number> {
  try {
    const setting = await prisma.pipelineSetting.findUnique({
      where: { key: 'qualification_threshold' },
      select: { valueJson: true },
    });
    if (setting?.valueJson !== null && setting?.valueJson !== undefined) {
      const value = typeof setting.valueJson === 'number'
        ? setting.valueJson
        : Number(setting.valueJson);
      if (Number.isFinite(value) && value >= 0 && value <= 1) {
        return value;
      }
    }
  } catch {
    // DB failure — fall back to default
  }
  return DEFAULT_QUALIFICATION_THRESHOLD;
}

/**
 * Feature keys consumed by the trained logistic regression model.
 * Must stay in sync with model.train NUMERIC_FEATURE_KEYS.
 *
 * 47 features: 18 original + 7 Wave-1 + 2 category-coverage + 11 v2 + 9 v2.1 enhanced scraper.
 * (instagram_is_verified removed — unreliable signal for UAE SMBs)
 */
export const TRAINED_MODEL_FEATURE_KEYS = [
  // ── Original (noise features physical_store_present + abandonment_signal_detected removed) ──
  'industry_supported',
  'has_whatsapp',
  'has_instagram',
  'accepts_online_payments',
  'review_count',
  'follower_count',
  'physical_address_present',
  'recent_activity',
  'custom_order_signals',
  'pure_self_serve_ecom',
  'shopify_detected',
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
  // ── Category-coverage additions (2) ──
  'bank_transfer_reliance',
  'upsell_signals',
  // ── v2 additions (Apify + Instagram + Apollo) ──
  'apify_payment_widget_count',
  'apify_has_shopify',
  'apify_has_booking_form',
  'apify_has_pricing_tiers',
  'apify_has_product_catalog',
  'instagram_follower_count',
  'instagram_engagement_rate',
  'instagram_is_business_account',
  'instagram_days_since_last_post',
  'instagram_has_bio_link',
  'has_decision_maker_phone',
  // ── v2.1 additions (enhanced scraper features) ──
  'decision_maker_count',
  'apollo_has_direct_phone',
  'website_email_count',
  'website_phone_count',
  'social_link_count',
  'has_linkedin',
  'tech_stack_size',
  'estimated_employees',
  'instagram_has_business_email',
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

// ── Consolidated scoring helpers ──

const BASELINE_FEATURE_EXTRACTOR_VERSION = 'features_v1';
const BASELINE_TRAINING_RUN_TRIGGER = 'MANUAL';

export function deterministicChecksum(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function asDeterministicRules(
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

export async function ensureBaselineModelVersion(): Promise<string> {
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
    featureKeys: TRAINED_MODEL_FEATURE_KEYS,
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
            keys: TRAINED_MODEL_FEATURE_KEYS,
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
