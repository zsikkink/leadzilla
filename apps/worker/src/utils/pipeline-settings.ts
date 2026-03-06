import { prisma } from '@lead-flood/db';

/**
 * Runtime-configurable pipeline settings loaded from the PipelineSetting table.
 * Every value has a sensible default — missing DB rows are fine.
 */
export interface PipelineSettings {
  /** Days to retain completed outbox events before cleanup (default: 30). */
  outboxRetentionDays: number;
  /** Milliseconds before a 'processing' lead is considered stuck (default: 3600000 = 1h). */
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
  scoreMin: 0,
  scoreMax: 1,
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
