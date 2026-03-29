import type { CreateRetrainRunRequest } from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';
import {
  MODEL_TRAIN_JOB_NAME,
  MODEL_TRAIN_RETRY_OPTIONS,
  type ModelTrainJobPayload,
} from './model.train.job.js';

export const MODEL_TRAIN_SCHEDULE_JOB_NAME = 'model.train.schedule';

export const MODEL_TRAIN_SCHEDULE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'model.train.schedule.dead_letter',
};

export interface ModelTrainScheduleJobPayload
  extends Pick<CreateRetrainRunRequest, 'windowDays' | 'minSamples' | 'activateIfPass'> {
  trigger: 'SCHEDULED';
  correlationId?: string | undefined;
}

export interface ModelTrainScheduleLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface ModelTrainScheduleJobDependencies {
  boss: Pick<PgBoss, 'send'>;
}

function buildScheduledTrainingRunId(jobId: string): string {
  return `scheduled:model.train:${jobId}`;
}

function formatModelTrainEnqueueFailure(error: unknown): string {
  return `Failed to enqueue model.train job: ${formatErrorMessage(error)}`;
}

export async function handleModelTrainScheduleJob(
  logger: ModelTrainScheduleLogger,
  job: Job<ModelTrainScheduleJobPayload>,
  dependencies: ModelTrainScheduleJobDependencies,
): Promise<void> {
  const { correlationId, trigger, windowDays, minSamples, activateIfPass } = job.data;
  const trainingRunId = buildScheduledTrainingRunId(job.id);
  const now = new Date();
  const trainingWindowStart = new Date(now);
  trainingWindowStart.setDate(trainingWindowStart.getDate() - windowDays);
  let trainingRunPrepared = false;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      trainingRunId,
      correlationId: correlationId ?? job.id,
      trigger,
      windowDays,
      minSamples,
    },
    'Started model.train.schedule job',
  );

  try {
    await prisma.trainingRun.upsert({
      where: { id: trainingRunId },
      update: {
        status: 'QUEUED',
        endedAt: null,
        errorMessage: null,
      },
      create: {
        id: trainingRunId,
        modelType: 'LOGISTIC_REGRESSION',
        status: 'QUEUED',
        trigger,
        configJson: {
          windowDays,
          minSamples,
          activateIfPass,
        },
        trainingWindowStart,
        trainingWindowEnd: now,
      },
    });
    trainingRunPrepared = true;

    const payload = {
      runId: trainingRunId,
      trainingRunId,
      trigger,
      windowDays,
      minSamples,
      activateIfPass,
      correlationId: correlationId ?? job.id,
    } satisfies ModelTrainJobPayload;

    await dependencies.boss.send(MODEL_TRAIN_JOB_NAME, payload, {
      singletonKey: `model.train:${trainingRunId}`,
      ...MODEL_TRAIN_RETRY_OPTIONS,
    });

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        trainingRunId,
        correlationId: correlationId ?? job.id,
      },
      'Enqueued model.train from scheduled retraining',
    );
  } catch (error: unknown) {
    if (trainingRunPrepared) {
      try {
        await prisma.trainingRun.update({
          where: { id: trainingRunId },
          data: {
            status: 'FAILED',
            endedAt: new Date(),
            errorMessage: formatModelTrainEnqueueFailure(error),
          },
        });
      } catch (trainingRunUpdateError: unknown) {
        logger.error(
          {
            jobId: job.id,
            queue: job.name,
            trainingRunId,
            correlationId: correlationId ?? job.id,
            error: trainingRunUpdateError,
          },
          'Failed to mark scheduled training run as failed after enqueue error',
        );
      }
    }

    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        trainingRunId,
        correlationId: correlationId ?? job.id,
        error,
      },
      'Failed model.train.schedule job',
    );

    throw error;
  }
}
