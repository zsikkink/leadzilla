import { prisma } from '@lead-flood/db';

/**
 * Runtime-configurable pipeline settings loaded from the PipelineSetting table.
 * Every value has a sensible default — missing DB rows are fine.
 */
export interface PipelineSettings {
  /** Days to retain completed outbox events before cleanup (default: 30). */
  outboxRetentionDays: number;
  /** Milliseconds before a 'processing' lead is moved to 'stuck' (default: 3600000 = 1h). */
  stuckLeadThresholdMs: number;
  /** Max DLQ retries before permanent failure (default: 3). */
  dlqMaxRetries: number;
  /** Batch size for DLQ processing (default: 100). */
  dlqBatchSize: number;
  /** New labels needed before auto-triggering model.train (default: 50). */
  retrainThreshold: number;
  /** Days without feedback before a lead is labeled cold (default: 30). */
  coldLeadTimeoutDays: number;
  /** DLQ depth alert threshold for pipeline health (default: 10). */
  healthDlqDepthThreshold: number;
  /** Stale job age threshold in minutes for health alerts (default: 60). */
  healthStaleJobMinutes: number;
}

const DEFAULTS: PipelineSettings = {
  outboxRetentionDays: 30,
  stuckLeadThresholdMs: 60 * 60 * 1000,
  dlqMaxRetries: 3,
  dlqBatchSize: 100,
  retrainThreshold: 50,
  coldLeadTimeoutDays: 30,
  healthDlqDepthThreshold: 10,
  healthStaleJobMinutes: 60,
};

/** Maps PipelineSetting.key → PipelineSettings property name. */
const KEY_MAP: Record<string, keyof PipelineSettings> = {
  'outbox.retention_days': 'outboxRetentionDays',
  'stuck_lead.threshold_ms': 'stuckLeadThresholdMs',
  'dlq.max_retries': 'dlqMaxRetries',
  'dlq.batch_size': 'dlqBatchSize',
  'labels.retrain_threshold': 'retrainThreshold',
  'labels.cold_lead_timeout_days': 'coldLeadTimeoutDays',
  'health.dlq_depth_threshold': 'healthDlqDepthThreshold',
  'health.stale_job_minutes': 'healthStaleJobMinutes',
};

/**
 * Batch-loads all PipelineSetting rows and merges with defaults.
 * Call once at the start of a job handler for runtime-configurable behavior.
 *
 * Never throws — returns defaults if the DB query fails.
 */
export async function getPipelineSettings(): Promise<PipelineSettings> {
  try {
    const rows = await prisma.pipelineSetting.findMany({
      where: { key: { in: Object.keys(KEY_MAP) } },
      select: { key: true, valueJson: true },
    });

    const settings = { ...DEFAULTS };

    for (const row of rows) {
      const prop = KEY_MAP[row.key];
      if (!prop) continue;

      const value = row.valueJson;
      if (typeof value === 'number' && Number.isFinite(value)) {
        (settings as Record<string, number>)[prop] = value;
      }
    }

    return settings;
  } catch {
    // DB failure is non-fatal — use defaults
    return { ...DEFAULTS };
  }
}

// ── Auto-approve configuration ────────────────────────────────────────

export interface AutoApproveConfig {
  enabled: boolean;
  scoreMin: number;
  scoreMax: number;
}

const AUTO_APPROVE_DEFAULTS: AutoApproveConfig = {
  enabled: false,
  scoreMin: 100,
  scoreMax: 100,
};

const AUTO_APPROVE_KEYS = [
  'auto_approve_enabled',
  'auto_approve_score_min',
  'auto_approve_score_max',
] as const;

/**
 * Load auto-approve configuration from PipelineSetting.
 * Returns { enabled: false } if settings are missing (OFF by default).
 * Never throws.
 */
export async function loadAutoApproveConfig(): Promise<AutoApproveConfig> {
  try {
    const rows = await prisma.pipelineSetting.findMany({
      where: { key: { in: [...AUTO_APPROVE_KEYS] } },
      select: { key: true, valueJson: true },
    });

    const config = { ...AUTO_APPROVE_DEFAULTS };

    for (const row of rows) {
      if (row.key === 'auto_approve_enabled' && typeof row.valueJson === 'boolean') {
        config.enabled = row.valueJson;
      } else if (row.key === 'auto_approve_score_min' && typeof row.valueJson === 'number') {
        config.scoreMin = row.valueJson;
      } else if (row.key === 'auto_approve_score_max' && typeof row.valueJson === 'number') {
        config.scoreMax = row.valueJson;
      }
    }

    return config;
  } catch {
    return { ...AUTO_APPROVE_DEFAULTS };
  }
}

/**
 * Compute whether a lead should be auto-approved based on PipelineSetting config
 * and the lead's blended score.
 */
export function shouldAutoApprove(config: AutoApproveConfig, blendedScore: number): boolean {
  return config.enabled && blendedScore >= config.scoreMin && blendedScore <= config.scoreMax;
}

/**
 * Global manual-approval gate for message drafts.
 * When enabled, worker never auto-approves drafts and all sends require explicit user approval.
 * Default: false (opt-in until explicitly enabled).
 */
export async function isManualApprovalOnlyEnabled(): Promise<boolean> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'messaging_manual_approval_only' },
      select: { valueJson: true },
    });
    if (typeof row?.valueJson === 'boolean') {
      return row.valueJson;
    }
  } catch {
    // Fall through to default
  }
  return false;
}

// ── Discovery rate helpers ────────────────────────────────────────────

/**
 * Load the historical conversion rate (qualified leads / unique businesses)
 * for an ICP. Returns null if no historical data exists.
 */
export async function loadConversionRate(icpProfileId: string): Promise<number | null> {
  try {
    const setting = await prisma.pipelineSetting.findUnique({
      where: { key: `discovery_conversion_rate:${icpProfileId}` },
      select: { valueJson: true },
    });
    if (setting?.valueJson === null || setting?.valueJson === undefined) return null;
    const value = typeof setting.valueJson === 'number'
      ? setting.valueJson
      : Number(setting.valueJson);
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Load the historical search efficiency (unique businesses / search task)
 * for an ICP. Returns null if no historical data exists.
 */
export async function loadSearchEfficiency(icpProfileId: string): Promise<number | null> {
  try {
    const setting = await prisma.pipelineSetting.findUnique({
      where: { key: `discovery_search_efficiency:${icpProfileId}` },
      select: { valueJson: true },
    });
    if (setting?.valueJson === null || setting?.valueJson === undefined) return null;
    const value = typeof setting.valueJson === 'number'
      ? setting.valueJson
      : Number(setting.valueJson);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

// ── UI-configured pipeline settings ──────────────────────────────────────
// These are saved by the Settings UI (PUT /v1/settings/pipeline/{key})
// and read at runtime by worker jobs. Every getter has a sensible default
// so the pipeline works even if the setting was never explicitly saved.

/**
 * Deterministic/AI blend weight override (saved as 0–100 = percent deterministic).
 * Returns as a 0–1 fraction, or null if not set (meaning: use dynamic auto-blending).
 */
export async function getDeterministicAiBlend(): Promise<number | null> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'deterministicAiBlend' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val >= 0 && val <= 100) {
        return val / 100;
      }
    }
  } catch { /* DB failure — use dynamic blending */ }
  return null;
}

/**
 * Minimum blended score to justify paid enrichment (Apollo reveal).
 * Leads scoring below this skip paid API calls. Default: 0.3.
 */
export async function getEnrichmentThreshold(): Promise<number> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'enrichmentThreshold' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val >= 0 && val <= 1) {
        return val;
      }
    }
  } catch { /* fall through */ }
  return 0.3;
}

/**
 * Score tier band thresholds { low, high }.
 * Scores < low → LOW, low..high → MEDIUM, ≥ high → HIGH.
 * Default: { low: 0.34, high: 0.67 }.
 */
export async function getScoreTierBands(): Promise<{ low: number; high: number }> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'scoreTierBands' },
      select: { valueJson: true },
    });
    if (row?.valueJson && typeof row.valueJson === 'object') {
      const val = row.valueJson as Record<string, unknown>;
      const low = typeof val.low === 'number' ? val.low : 0.34;
      const high = typeof val.high === 'number' ? val.high : 0.67;
      if (Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low && high <= 1) {
        return { low, high };
      }
    }
  } catch { /* fall through */ }
  return { low: 0.34, high: 0.67 };
}

/**
 * Maximum follow-ups per lead before stopping outreach. Default: 3.
 */
export async function getFollowUpMaxCount(): Promise<number> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'followUpMaxCount' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val >= 0 && val <= 100) {
        return val;
      }
    }
  } catch { /* fall through */ }
  return 3;
}

/**
 * WhatsApp daily send limit. Default: 50.
 */
export async function getWhatsappDailyLimit(): Promise<number> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'whatsappDailyLimit' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val >= 1) {
        return val;
      }
    }
  } catch { /* fall through */ }
  return 50;
}

/**
 * Email daily send cap (overrides warmup maxDaily). Default: 100.
 */
export async function getEmailDailyLimit(): Promise<number> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'emailDailyLimit' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val >= 1) {
        return val;
      }
    }
  } catch { /* fall through */ }
  return 100;
}

/**
 * Minimum AUC required to activate a newly trained ML model. Default: 0.60.
 */
export async function getModelActivationAuc(): Promise<number> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'modelActivationAuc' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val >= 0 && val <= 1) {
        return val;
      }
    }
  } catch { /* fall through */ }
  return 0.60;
}

/**
 * Daily spend ceiling per provider in dollars. Default: null (no ceiling).
 * Returns ceiling in cents for comparison with DiscoveryCostEvent.costCents.
 */
export async function getProviderBudgetCeiling(): Promise<number | null> {
  try {
    const row = await prisma.pipelineSetting.findUnique({
      where: { key: 'providerBudgetCeiling' },
      select: { valueJson: true },
    });
    if (row?.valueJson !== null && row?.valueJson !== undefined) {
      const val = typeof row.valueJson === 'number' ? row.valueJson : Number(row.valueJson);
      if (Number.isFinite(val) && val > 0) {
        return val * 100; // dollars → cents
      }
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Check if a provider has exceeded its daily budget ceiling.
 * Returns true if within budget (or no ceiling configured), false if over.
 */
export async function isProviderWithinBudget(
  provider: 'APOLLO' | 'HUNTER' | 'SERPAPI',
): Promise<boolean> {
  const ceiling = await getProviderBudgetCeiling();
  if (ceiling === null) return true;

  try {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const result = await prisma.discoveryCostEvent.aggregate({
      where: {
        provider,
        createdAt: { gte: dayStart },
      },
      _sum: { costCents: true },
    });
    return (result._sum.costCents ?? 0) < ceiling;
  } catch {
    return true; // DB failure → allow (don't block pipeline)
  }
}
