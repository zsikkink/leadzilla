import type PgBoss from 'pg-boss';

import {
  ANALYTICS_ROLLUP_JOB_NAME,
  type AnalyticsRollupJobPayload,
  ANALYTICS_ROLLUP_RETRY_OPTIONS,
} from './jobs/analytics.rollup.job.js';
import {
  FOLLOWUP_CHECK_JOB_NAME,
  type FollowupCheckJobPayload,
  FOLLOWUP_CHECK_RETRY_OPTIONS,
} from './jobs/followup.check.job.js';
import {
  type HeartbeatJobPayload,
} from './jobs/heartbeat.job.js';
import {
  DISCOVERY_SEED_JOB_NAME,
  DISCOVERY_SEED_RETRY_OPTIONS,
  type DiscoverySeedJobPayload,
} from './jobs/discovery.seed.job.js';
import {
  LABELS_GENERATE_JOB_NAME,
  type LabelsGenerateJobPayload,
  LABELS_GENERATE_RETRY_OPTIONS,
} from './jobs/labels.generate.job.js';
import {
  MANAGER_ANALYZE_JOB_NAME,
  type ManagerAnalyzeJobPayload,
  MANAGER_ANALYZE_RETRY_OPTIONS,
} from './jobs/manager.analyze.job.js';
import { MODEL_TRAIN_JOB_NAME, type ModelTrainJobPayload, MODEL_TRAIN_RETRY_OPTIONS } from './jobs/model.train.job.js';
import {
  SCORING_COMPUTE_JOB_NAME,
  type ScoringComputeJobPayload,
  SCORING_COMPUTE_RETRY_OPTIONS,
} from './jobs/scoring.compute.job.js';
import {
  DLQ_JOB_NAME,
  type DlqProcessJobPayload,
  DLQ_PROCESS_RETRY_OPTIONS,
} from './jobs/dlq.process.job.js';
import {
  SCORING_BATCH_JOB_NAME,
  type ScoringBatchJobPayload,
  SCORING_BATCH_RETRY_OPTIONS,
} from './jobs/scoring.batch.job.js';
import {
  LEAD_RECOVERY_JOB_NAME,
  type LeadRecoveryJobPayload,
  LEAD_RECOVERY_RETRY_OPTIONS,
} from './jobs/lead.recovery.job.js';
import {
  OUTBOX_CLEANUP_JOB_NAME,
  type OutboxCleanupJobPayload,
  OUTBOX_CLEANUP_RETRY_OPTIONS,
} from './jobs/outbox.cleanup.job.js';
import {
  PIPELINE_HEALTH_JOB_NAME,
  type PipelineHealthJobPayload,
  PIPELINE_HEALTH_RETRY_OPTIONS,
} from './jobs/pipeline.health.job.js';
import { HEARTBEAT_QUEUE_NAME, HEARTBEAT_RETRY_OPTIONS } from './queues.js';

export async function registerWorkerSchedules(boss: Pick<PgBoss, 'schedule'>): Promise<void> {

  await boss.schedule(
    HEARTBEAT_QUEUE_NAME,
    '*/1 * * * *',
    { source: 'scheduler' } satisfies HeartbeatJobPayload,
    {
      singletonKey: 'system.heartbeat',
      ...HEARTBEAT_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    DISCOVERY_SEED_JOB_NAME,
    '0 4 * * 1',
    {
      reason: 'scheduled',
      correlationId: 'scheduler:discovery.seed',
    } satisfies DiscoverySeedJobPayload,
    {
      singletonKey: 'schedule:discovery.seed',
      ...DISCOVERY_SEED_RETRY_OPTIONS,
    },
  );

  // TODO(staleness): from/to are baked at schedule-registration time.
  // labels.generate handler should compute the window at runtime
  // (e.g. now - 24h → now) and ignore stale schedule values.
  await boss.schedule(
    LABELS_GENERATE_JOB_NAME,
    '0 * * * *',
    {
      runId: 'scheduled:labels.generate',
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date().toISOString(),
      correlationId: 'scheduler:labels.generate',
    } satisfies LabelsGenerateJobPayload,
    {
      singletonKey: 'schedule:labels.generate',
      ...LABELS_GENERATE_RETRY_OPTIONS,
    },
  );

  // B6 fix: Generate unique trainingRunId per invocation to avoid PK collisions.
  // pg-boss schedule sends a new job each cron tick — the static ID was causing
  // duplicate TrainingRun upserts to collide with old records.
  await boss.schedule(
    MODEL_TRAIN_JOB_NAME,
    '0 3 * * 1',
    {
      runId: `scheduled:model.train:${Date.now()}`,
      trainingRunId: `scheduled:model.train:${Date.now()}`,
      trigger: 'SCHEDULED',
      windowDays: 90,
      minSamples: 100,
      activateIfPass: true,
      correlationId: 'scheduler:model.train',
    } satisfies ModelTrainJobPayload,
    {
      singletonKey: 'schedule:model.train',
      ...MODEL_TRAIN_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    SCORING_COMPUTE_JOB_NAME,
    '15 2 * * *',
    {
      runId: 'scheduled:scoring.compute',
      mode: 'ALL_ACTIVE_ICPS',
      correlationId: 'scheduler:scoring.compute',
    } satisfies ScoringComputeJobPayload,
    {
      singletonKey: 'schedule:scoring.compute',
      ...SCORING_COMPUTE_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    ANALYTICS_ROLLUP_JOB_NAME,
    '0 1 * * *',
    {
      runId: 'scheduled:analytics.rollup',
      day: 'auto',
      fullRecompute: false,
      correlationId: 'scheduler:analytics.rollup',
    } satisfies AnalyticsRollupJobPayload,
    {
      singletonKey: 'schedule:analytics.rollup',
      ...ANALYTICS_ROLLUP_RETRY_OPTIONS,
    },
  );

  // Weekly on Monday at 9am UTC
  await boss.schedule(
    MANAGER_ANALYZE_JOB_NAME,
    '0 9 * * 1',
    {
      runId: 'scheduled:manager.analyze',
      correlationId: 'scheduler:manager.analyze',
    } satisfies ManagerAnalyzeJobPayload,
    {
      singletonKey: 'schedule:manager.analyze',
      ...MANAGER_ANALYZE_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    FOLLOWUP_CHECK_JOB_NAME,
    '0 5-14 * * *',
    {
      runId: 'scheduled:followup.check',
      correlationId: 'scheduler:followup.check',
    } satisfies FollowupCheckJobPayload,
    {
      singletonKey: 'schedule:followup.check',
      ...FOLLOWUP_CHECK_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    DLQ_JOB_NAME,
    '0 * * * *',
    {
      correlationId: 'scheduler:dlq.process',
    } satisfies DlqProcessJobPayload,
    {
      singletonKey: 'schedule:dlq.process',
      ...DLQ_PROCESS_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    SCORING_BATCH_JOB_NAME,
    '0 * * * *',
    {
      runId: 'scheduled:scoring.batch',
      correlationId: 'scheduler:scoring.batch',
    } satisfies ScoringBatchJobPayload,
    {
      singletonKey: 'schedule:scoring.batch',
      ...SCORING_BATCH_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    PIPELINE_HEALTH_JOB_NAME,
    '*/15 * * * *',
    {
      correlationId: 'scheduler:pipeline.health',
    } satisfies PipelineHealthJobPayload,
    {
      singletonKey: 'schedule:pipeline.health',
      ...PIPELINE_HEALTH_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    OUTBOX_CLEANUP_JOB_NAME,
    '30 * * * *',
    {
      correlationId: 'scheduler:outbox.cleanup',
    } satisfies OutboxCleanupJobPayload,
    {
      singletonKey: 'schedule:outbox.cleanup',
      ...OUTBOX_CLEANUP_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    LEAD_RECOVERY_JOB_NAME,
    '*/15 * * * *',
    {
      correlationId: 'scheduler:lead.recovery',
    } satisfies LeadRecoveryJobPayload,
    {
      singletonKey: 'schedule:lead.recovery',
      ...LEAD_RECOVERY_RETRY_OPTIONS,
    },
  );
}
