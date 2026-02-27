import type PgBoss from 'pg-boss';
import type { SendOptions } from 'pg-boss';

import {
  ANALYTICS_ROLLUP_JOB_NAME,
  ANALYTICS_ROLLUP_RETRY_OPTIONS,
} from './jobs/analytics.rollup.job.js';
import { DISCOVERY_RUN_JOB_NAME, DISCOVERY_RUN_RETRY_OPTIONS } from './jobs/discovery.run.job.js';
import { ENRICHMENT_RUN_JOB_NAME, ENRICHMENT_RUN_RETRY_OPTIONS } from './jobs/enrichment.run.job.js';
import { FOLLOWUP_CHECK_JOB_NAME, FOLLOWUP_CHECK_RETRY_OPTIONS } from './jobs/followup.check.job.js';
import {
  DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
  DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
} from './jobs/discovery.run_search_task.job.js';
import {
  DISCOVERY_SEED_JOB_NAME,
  DISCOVERY_SEED_RETRY_OPTIONS,
} from './jobs/discovery.seed.job.js';
import {
  FEATURES_COMPUTE_JOB_NAME,
  FEATURES_COMPUTE_RETRY_OPTIONS,
} from './jobs/features.compute.job.js';
import { LABELS_GENERATE_JOB_NAME, LABELS_GENERATE_RETRY_OPTIONS } from './jobs/labels.generate.job.js';
import { MESSAGE_GENERATE_JOB_NAME, MESSAGE_GENERATE_RETRY_OPTIONS } from './jobs/message.generate.job.js';
import { MESSAGE_SEND_JOB_NAME, MESSAGE_SEND_RETRY_OPTIONS } from './jobs/message.send.job.js';
import { NOTIFY_SALES_JOB_NAME, NOTIFY_SALES_RETRY_OPTIONS } from './jobs/notify.sales.job.js';
import { MODEL_EVALUATE_JOB_NAME, MODEL_EVALUATE_RETRY_OPTIONS } from './jobs/model.evaluate.job.js';
import { MODEL_TRAIN_JOB_NAME, MODEL_TRAIN_RETRY_OPTIONS } from './jobs/model.train.job.js';
import { REPLY_CLASSIFY_JOB_NAME, REPLY_CLASSIFY_RETRY_OPTIONS } from './jobs/reply.classify.job.js';
import {
  MANAGER_ANALYZE_JOB_NAME,
  MANAGER_ANALYZE_RETRY_OPTIONS,
} from './jobs/manager.analyze.job.js';
import {
  SCORING_COMPUTE_JOB_NAME,
  SCORING_COMPUTE_RETRY_OPTIONS,
} from './jobs/scoring.compute.job.js';
import {
  SCORING_BATCH_JOB_NAME,
  SCORING_BATCH_RETRY_OPTIONS,
} from './jobs/scoring.batch.job.js';
import { LEAD_RECOVERY_JOB_NAME, LEAD_RECOVERY_RETRY_OPTIONS } from './jobs/lead.recovery.job.js';
import { OUTBOX_CLEANUP_JOB_NAME, OUTBOX_CLEANUP_RETRY_OPTIONS } from './jobs/outbox.cleanup.job.js';
import {
  BUSINESS_PREQUALIFY_JOB_NAME,
  BUSINESS_PREQUALIFY_RETRY_OPTIONS,
} from './jobs/business.prequalify.job.js';
import {
  BUSINESS_CONVERT_JOB_NAME,
  BUSINESS_CONVERT_RETRY_OPTIONS,
} from './jobs/business.convert.job.js';
import {
  PIPELINE_HEALTH_JOB_NAME,
  PIPELINE_HEALTH_RETRY_OPTIONS,
} from './jobs/pipeline.health.job.js';
// DLQ constants inlined to break circular dependency (dlq.process.job.ts imports WORKER_QUEUE_DEFINITIONS from here)
const DLQ_JOB_NAME = 'dlq.process';
const DLQ_PROCESS_RETRY_OPTIONS: Pick<SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'dlq.process.dead_letter',
};

export const HEARTBEAT_QUEUE_NAME = 'system.heartbeat';

export const HEARTBEAT_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 5,
  retryBackoff: false,
  deadLetter: 'system.heartbeat.dead_letter',
};

interface QueueRetryOptions {
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  deadLetter: string;
}

interface WorkerQueueDefinition {
  name: string;
  retryOptions: QueueRetryOptions;
}

function normalizeRetryOptions(
  queueName: string,
  retryOptions: Pick<SendOptions, 'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'>,
): QueueRetryOptions {
  const { retryLimit, retryDelay, retryBackoff, deadLetter } = retryOptions;

  if (
    retryLimit === undefined ||
    retryDelay === undefined ||
    retryBackoff === undefined ||
    deadLetter === undefined
  ) {
    throw new Error(`Invalid retry options for queue '${queueName}'`);
  }

  return {
    retryLimit,
    retryDelay,
    retryBackoff,
    deadLetter,
  };
}

export const WORKER_QUEUE_DEFINITIONS: readonly WorkerQueueDefinition[] = [
  {
    name: HEARTBEAT_QUEUE_NAME,
    retryOptions: normalizeRetryOptions(HEARTBEAT_QUEUE_NAME, HEARTBEAT_RETRY_OPTIONS),
  },
  {
    name: DISCOVERY_RUN_JOB_NAME,
    retryOptions: normalizeRetryOptions(DISCOVERY_RUN_JOB_NAME, DISCOVERY_RUN_RETRY_OPTIONS),
  },
  {
    name: DISCOVERY_SEED_JOB_NAME,
    retryOptions: normalizeRetryOptions(DISCOVERY_SEED_JOB_NAME, DISCOVERY_SEED_RETRY_OPTIONS),
  },
  {
    name: DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
    retryOptions: normalizeRetryOptions(
      DISCOVERY_RUN_SEARCH_TASK_JOB_NAME,
      DISCOVERY_RUN_SEARCH_TASK_RETRY_OPTIONS,
    ),
  },
  {
    name: BUSINESS_PREQUALIFY_JOB_NAME,
    retryOptions: normalizeRetryOptions(BUSINESS_PREQUALIFY_JOB_NAME, BUSINESS_PREQUALIFY_RETRY_OPTIONS),
  },
  {
    name: BUSINESS_CONVERT_JOB_NAME,
    retryOptions: normalizeRetryOptions(BUSINESS_CONVERT_JOB_NAME, BUSINESS_CONVERT_RETRY_OPTIONS),
  },
  {
    name: ENRICHMENT_RUN_JOB_NAME,
    retryOptions: normalizeRetryOptions(ENRICHMENT_RUN_JOB_NAME, ENRICHMENT_RUN_RETRY_OPTIONS),
  },
  {
    name: FEATURES_COMPUTE_JOB_NAME,
    retryOptions: normalizeRetryOptions(FEATURES_COMPUTE_JOB_NAME, FEATURES_COMPUTE_RETRY_OPTIONS),
  },
  {
    name: LABELS_GENERATE_JOB_NAME,
    retryOptions: normalizeRetryOptions(LABELS_GENERATE_JOB_NAME, LABELS_GENERATE_RETRY_OPTIONS),
  },
  {
    name: SCORING_COMPUTE_JOB_NAME,
    retryOptions: normalizeRetryOptions(SCORING_COMPUTE_JOB_NAME, SCORING_COMPUTE_RETRY_OPTIONS),
  },
  {
    name: SCORING_BATCH_JOB_NAME,
    retryOptions: normalizeRetryOptions(SCORING_BATCH_JOB_NAME, SCORING_BATCH_RETRY_OPTIONS),
  },
  {
    name: MODEL_TRAIN_JOB_NAME,
    retryOptions: normalizeRetryOptions(MODEL_TRAIN_JOB_NAME, MODEL_TRAIN_RETRY_OPTIONS),
  },
  {
    name: MODEL_EVALUATE_JOB_NAME,
    retryOptions: normalizeRetryOptions(MODEL_EVALUATE_JOB_NAME, MODEL_EVALUATE_RETRY_OPTIONS),
  },
  {
    name: MESSAGE_GENERATE_JOB_NAME,
    retryOptions: normalizeRetryOptions(MESSAGE_GENERATE_JOB_NAME, MESSAGE_GENERATE_RETRY_OPTIONS),
  },
  {
    name: MESSAGE_SEND_JOB_NAME,
    retryOptions: normalizeRetryOptions(MESSAGE_SEND_JOB_NAME, MESSAGE_SEND_RETRY_OPTIONS),
  },
  {
    name: ANALYTICS_ROLLUP_JOB_NAME,
    retryOptions: normalizeRetryOptions(ANALYTICS_ROLLUP_JOB_NAME, ANALYTICS_ROLLUP_RETRY_OPTIONS),
  },
  {
    name: FOLLOWUP_CHECK_JOB_NAME,
    retryOptions: normalizeRetryOptions(FOLLOWUP_CHECK_JOB_NAME, FOLLOWUP_CHECK_RETRY_OPTIONS),
  },
  {
    name: REPLY_CLASSIFY_JOB_NAME,
    retryOptions: normalizeRetryOptions(REPLY_CLASSIFY_JOB_NAME, REPLY_CLASSIFY_RETRY_OPTIONS),
  },
  {
    name: NOTIFY_SALES_JOB_NAME,
    retryOptions: normalizeRetryOptions(NOTIFY_SALES_JOB_NAME, NOTIFY_SALES_RETRY_OPTIONS),
  },
  {
    name: MANAGER_ANALYZE_JOB_NAME,
    retryOptions: normalizeRetryOptions(MANAGER_ANALYZE_JOB_NAME, MANAGER_ANALYZE_RETRY_OPTIONS),
  },
  {
    name: DLQ_JOB_NAME,
    retryOptions: normalizeRetryOptions(DLQ_JOB_NAME, DLQ_PROCESS_RETRY_OPTIONS),
  },
  {
    name: PIPELINE_HEALTH_JOB_NAME,
    retryOptions: normalizeRetryOptions(PIPELINE_HEALTH_JOB_NAME, PIPELINE_HEALTH_RETRY_OPTIONS),
  },
  {
    name: OUTBOX_CLEANUP_JOB_NAME,
    retryOptions: normalizeRetryOptions(OUTBOX_CLEANUP_JOB_NAME, OUTBOX_CLEANUP_RETRY_OPTIONS),
  },
  {
    name: LEAD_RECOVERY_JOB_NAME,
    retryOptions: normalizeRetryOptions(LEAD_RECOVERY_JOB_NAME, LEAD_RECOVERY_RETRY_OPTIONS),
  },
] as const;

function toQueueOptions(definition: WorkerQueueDefinition): PgBoss.Queue {
  return {
    name: definition.name,
    retryLimit: definition.retryOptions.retryLimit,
    retryDelay: definition.retryOptions.retryDelay,
    retryBackoff: definition.retryOptions.retryBackoff,
    deadLetter: definition.retryOptions.deadLetter,
  };
}

export async function ensureWorkerQueues(boss: Pick<PgBoss, 'createQueue'>): Promise<void> {
  const deadLetterQueues = new Set<string>();

  for (const definition of WORKER_QUEUE_DEFINITIONS) {
    if (definition.retryOptions.deadLetter) {
      deadLetterQueues.add(definition.retryOptions.deadLetter);
    }
  }

  for (const deadLetterQueueName of deadLetterQueues) {
    await boss.createQueue(deadLetterQueueName, { name: deadLetterQueueName });
  }

  for (const definition of WORKER_QUEUE_DEFINITIONS) {
    await boss.createQueue(definition.name, toQueueOptions(definition));
  }
}
