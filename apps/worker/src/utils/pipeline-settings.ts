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
