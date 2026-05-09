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
  MESSAGE_APPROVAL_RECOVERY_JOB_NAME,
  type MessageApprovalRecoveryJobPayload,
  MESSAGE_APPROVAL_RECOVERY_RETRY_OPTIONS,
} from './jobs/message.approval.recovery.job.js';
import {
  MESSAGE_SEND_RECOVERY_JOB_NAME,
  type MessageSendRecoveryJobPayload,
  MESSAGE_SEND_RECOVERY_RETRY_OPTIONS,
} from './jobs/message.send.recovery.job.js';
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
import {
  MODEL_TRAIN_SCHEDULE_JOB_NAME,
  type ModelTrainScheduleJobPayload,
  MODEL_TRAIN_SCHEDULE_RETRY_OPTIONS,
} from './jobs/model.train.schedule.job.js';
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
  DATA_RETENTION_JOB_NAME,
  type DataRetentionJobPayload,
  DATA_RETENTION_RETRY_OPTIONS,
} from './jobs/data.retention.job.js';
import {
  MODEL_DRIFT_JOB_NAME,
  type ModelDriftJobPayload,
  MODEL_DRIFT_RETRY_OPTIONS,
} from './jobs/model.drift.job.js';
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
import {
  SEARCH_TASK_RECOVERY_JOB_NAME,
  type SearchTaskRecoveryJobPayload,
  SEARCH_TASK_RECOVERY_RETRY_OPTIONS,
} from './jobs/search-task.recovery.job.js';
import { HEARTBEAT_QUEUE_NAME, HEARTBEAT_RETRY_OPTIONS } from './queues.js';

interface RegisterWorkerSchedulesOptions {
  discoveryScheduleEnabled?: boolean | undefined;
  logger?: {
    info: (object: Record<string, unknown>, message: string) => void;
  } | undefined;
}

export async function registerWorkerHeartbeatSchedule(
  boss: Pick<PgBoss, 'schedule'>,
): Promise<void> {
  await boss.schedule(
    HEARTBEAT_QUEUE_NAME,
    '*/1 * * * *',
    { source: 'scheduler' } satisfies HeartbeatJobPayload,
    {
      singletonKey: 'system.heartbeat',
      ...HEARTBEAT_RETRY_OPTIONS,
    },
  );
}

export async function registerWorkerSchedules(
  boss: Pick<PgBoss, 'schedule'>,
  options: RegisterWorkerSchedulesOptions = {},
): Promise<void> {
  await registerWorkerHeartbeatSchedule(boss);

  const discoveryScheduleEnabled = options.discoveryScheduleEnabled ?? true;
  if (discoveryScheduleEnabled) {
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
  } else {
    options.logger?.info(
      { discoveryScheduleEnabled },
      'Discovery schedule disabled by configuration',
    );
  }

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

  await boss.schedule(
    MODEL_TRAIN_SCHEDULE_JOB_NAME,
    '0 3 * * 1',
    {
      trigger: 'SCHEDULED',
      windowDays: 90,
      minSamples: 100,
      activateIfPass: true,
      correlationId: 'scheduler:model.train',
    } satisfies ModelTrainScheduleJobPayload,
    {
      singletonKey: 'schedule:model.train',
      ...MODEL_TRAIN_SCHEDULE_RETRY_OPTIONS,
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
    MESSAGE_APPROVAL_RECOVERY_JOB_NAME,
    '*/5 * * * *',
    {
      correlationId: 'scheduler:message.approval.recovery',
    } satisfies MessageApprovalRecoveryJobPayload,
    {
      singletonKey: 'schedule:message.approval.recovery',
      ...MESSAGE_APPROVAL_RECOVERY_RETRY_OPTIONS,
    },
  );

  await boss.schedule(
    MESSAGE_SEND_RECOVERY_JOB_NAME,
    '*/5 * * * *',
    {
      correlationId: 'scheduler:message.send.recovery',
    } satisfies MessageSendRecoveryJobPayload,
    {
      singletonKey: 'schedule:message.send.recovery',
      ...MESSAGE_SEND_RECOVERY_RETRY_OPTIONS,
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

  // Daily at 2:30 AM — data retention sweep (90-day default)
  await boss.schedule(
    DATA_RETENTION_JOB_NAME,
    '30 2 * * *',
    {
      correlationId: 'scheduler:data.retention',
    } satisfies DataRetentionJobPayload,
    {
      singletonKey: 'schedule:data.retention',
      ...DATA_RETENTION_RETRY_OPTIONS,
    },
  );

  // Daily at 6 AM — model drift detection
  await boss.schedule(
    MODEL_DRIFT_JOB_NAME,
    '0 6 * * *',
    {
      correlationId: 'scheduler:model.drift',
    } satisfies ModelDriftJobPayload,
    {
      singletonKey: 'schedule:model.drift',
      ...MODEL_DRIFT_RETRY_OPTIONS,
    },
  );

  // Every 15 minutes — search task recovery (stuck RUNNING >10min, abandoned PENDING >2h)
  await boss.schedule(
    SEARCH_TASK_RECOVERY_JOB_NAME,
    '*/15 * * * *',
    {
      correlationId: 'scheduler:search-task.recovery',
    } satisfies SearchTaskRecoveryJobPayload,
    {
      singletonKey: 'schedule:search-task.recovery',
      ...SEARCH_TASK_RECOVERY_RETRY_OPTIONS,
    },
  );
}
