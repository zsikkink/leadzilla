import {
  getPipelineSetting,
  listPipelineSettingsByKeys,
  prisma,
} from '@lead-flood/db';

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

async function loadPipelineSettingMap(keys: readonly string[]): Promise<Map<string, unknown>> {
  try {
    const rows = await listPipelineSettingsByKeys(keys);
    return new Map(
      rows.map((row: { key: string; valueJson: unknown }) => [row.key, row.valueJson]),
    );
  } catch {
    return new Map();
  }
}

async function loadPipelineSettingValue(key: string): Promise<unknown | null> {
  try {
    return (await getPipelineSetting(key))?.valueJson ?? null;
  } catch {
    return null;
  }
}

/**
 * Batch-loads all PipelineSetting rows and merges with defaults.
 * Call once at the start of a job handler for runtime-configurable behavior.
 *
 * Never throws — returns defaults if the DB query fails.
 */
export async function getPipelineSettings(): Promise<PipelineSettings> {
  const rows = await loadPipelineSettingMap(Object.keys(KEY_MAP));
  if (rows.size === 0) {
    return { ...DEFAULTS };
  }

  const settings = { ...DEFAULTS };

  for (const [key, value] of rows.entries()) {
    const prop = KEY_MAP[key];
    if (!prop) continue;

    if (typeof value === 'number' && Number.isFinite(value)) {
      (settings as Record<string, number>)[prop] = value;
    }
  }

  return settings;
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
  const rows = await loadPipelineSettingMap(AUTO_APPROVE_KEYS);
  if (rows.size === 0) {
    return { ...AUTO_APPROVE_DEFAULTS };
  }

  const config = { ...AUTO_APPROVE_DEFAULTS };

  const enabled = rows.get('auto_approve_enabled');
  if (typeof enabled === 'boolean') {
    config.enabled = enabled;
  }

  const scoreMin = rows.get('auto_approve_score_min');
  if (typeof scoreMin === 'number') {
    config.scoreMin = scoreMin;
  }

  const scoreMax = rows.get('auto_approve_score_max');
  if (typeof scoreMax === 'number') {
    config.scoreMax = scoreMax;
  }

  return config;
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
  const value = await loadPipelineSettingValue('messaging_manual_approval_only');
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}

// ── Discovery rate helpers ────────────────────────────────────────────

/**
 * Load the historical conversion rate (qualified leads / unique businesses)
 * for an ICP. Returns null if no historical data exists.
 */
export async function loadConversionRate(icpProfileId: string): Promise<number | null> {
  const valueJson = await loadPipelineSettingValue(`discovery_conversion_rate:${icpProfileId}`);
  if (valueJson === null || valueJson === undefined) return null;
  const value = typeof valueJson === 'number'
    ? valueJson
    : Number(valueJson);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : null;
}

/**
 * Load the historical search efficiency (unique businesses / search task)
 * for an ICP. Returns null if no historical data exists.
 */
export async function loadSearchEfficiency(icpProfileId: string): Promise<number | null> {
  const valueJson = await loadPipelineSettingValue(`discovery_search_efficiency:${icpProfileId}`);
  if (valueJson === null || valueJson === undefined) return null;
  const value = typeof valueJson === 'number'
    ? valueJson
    : Number(valueJson);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ── UI-configured pipeline settings ──────────────────────────────────────
// These are saved by the Settings UI (PUT /v1/settings/pipeline/{key})
// and read at runtime by worker jobs. Every getter has a sensible default
// so the pipeline works even if the setting was never explicitly saved.

/**
 * Lead qualification threshold after score blending. Default: 0.4.
 * Used by scoring jobs to decide if a lead is qualified for messaging.
 */
export async function getScoreQualificationThreshold(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('scoreQualificationThreshold');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 0 && val <= 1) {
      return val;
    }
  }
  return 0.4;
}

/**
 * Deterministic/AI blend weight override (saved as 0–100 = percent deterministic).
 * Returns as a 0–1 fraction, or null if not set (meaning: use dynamic auto-blending).
 */
export async function getDeterministicAiBlend(): Promise<number | null> {
  const valueJson = await loadPipelineSettingValue('deterministicAiBlend');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 0 && val <= 100) {
      return val / 100;
    }
  }
  return null;
}

/**
 * Minimum blended score to justify paid enrichment (Apollo reveal).
 * Leads scoring below this skip paid API calls. Default: 0.3.
 */
export async function getEnrichmentThreshold(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('enrichmentThreshold');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 0 && val <= 1) {
      return val;
    }
  }
  return 0.3;
}

/**
 * Minimum Google review count required to keep a business in discovery.
 * Default: 15.
 */
export async function getMinReviewCount(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('min_review_count');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 0) {
      return val;
    }
  }
  return 15;
}

/**
 * Score tier band thresholds { low, high }.
 * Scores < low → LOW, low..high → MEDIUM, ≥ high → HIGH.
 * Default: { low: 0.34, high: 0.67 }.
 */
export async function getScoreTierBands(): Promise<{ low: number; high: number }> {
  const valueJson = await loadPipelineSettingValue('scoreTierBands');
  if (valueJson && typeof valueJson === 'object') {
    const val = valueJson as Record<string, unknown>;
    const low = typeof val.low === 'number' ? val.low : 0.34;
    const high = typeof val.high === 'number' ? val.high : 0.67;
    if (Number.isFinite(low) && Number.isFinite(high) && low >= 0 && high >= low && high <= 1) {
      return { low, high };
    }
  }
  return { low: 0.34, high: 0.67 };
}

/**
 * Maximum follow-ups per lead before stopping outreach. Default: 3.
 */
export async function getFollowUpMaxCount(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('followUpMaxCount');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 0 && val <= 100) {
      return val;
    }
  }
  return 3;
}

/**
 * WhatsApp daily send limit. Default: 50.
 */
export async function getWhatsappDailyLimit(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('whatsappDailyLimit');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 1) {
      return val;
    }
  }
  return 50;
}

/**
 * Email daily send cap (overrides warmup maxDaily). Default: 10.
 */
export async function getEmailDailyLimit(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('emailDailyLimit');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 1) {
      return val;
    }
  }
  return 10;
}

/**
 * Messaging role/persona override for AI generation.
 * Returns null when unset to allow adapter defaults.
 */
export async function getMessagingRole(): Promise<string | null> {
  const valueJson = await loadPipelineSettingValue('messagingRole');
  if (typeof valueJson === 'string') {
    const value = valueJson.trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Messaging system prompt override for AI generation.
 * Returns null when unset to allow adapter defaults.
 */
export async function getMessagingSystemPrompt(): Promise<string | null> {
  const valueJson = await loadPipelineSettingValue('messagingSystemPrompt');
  if (typeof valueJson === 'string') {
    const value = valueJson.trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Additional user-defined messaging constraints.
 * Returns null when unset.
 */
export async function getMessagingInstructions(): Promise<string | null> {
  const valueJson = await loadPipelineSettingValue('messagingInstructions');
  if (typeof valueJson === 'string') {
    const value = valueJson.trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Minimum AUC required to activate a newly trained ML model. Default: 0.60.
 */
export async function getModelActivationAuc(): Promise<number> {
  const valueJson = await loadPipelineSettingValue('modelActivationAuc');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val >= 0 && val <= 1) {
      return val;
    }
  }
  return 0.60;
}

/**
 * Daily spend ceiling per provider in dollars. Default: null (no ceiling).
 * Returns ceiling in cents for comparison with DiscoveryCostEvent.costCents.
 */
export async function getProviderBudgetCeiling(): Promise<number | null> {
  const valueJson = await loadPipelineSettingValue('providerBudgetCeiling');
  if (valueJson !== null && valueJson !== undefined) {
    const val = typeof valueJson === 'number' ? valueJson : Number(valueJson);
    if (Number.isFinite(val) && val > 0) {
      return val * 100; // dollars → cents
    }
  }
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
