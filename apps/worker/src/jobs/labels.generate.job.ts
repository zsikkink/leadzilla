import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import type { ModelTrainJobPayload } from './model.train.job.js';

export const LABELS_GENERATE_JOB_NAME = 'labels.generate';
export const LABELS_GENERATE_IDEMPOTENCY_KEY_PATTERN =
  'labels.generate:${feedbackEventId || `${from}:${to}` }';

export const LABELS_GENERATE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 120,
  retryBackoff: true,
  deadLetter: 'labels.generate.dead_letter',
};

export interface LabelsGenerateJobPayload {
  runId: string;
  from: string;
  to: string;
  leadId?: string | undefined;
  feedbackEventId?: string | undefined;
  correlationId?: string | undefined;
}

export interface LabelsGenerateLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface LabelsGenerateJobDependencies {
  enqueueModelTrain?: ((payload: ModelTrainJobPayload) => Promise<void>) | undefined;
}

/** Feedback event types that indicate positive outcomes. */
const POSITIVE_EVENT_TYPES = new Set(['MEETING_BOOKED', 'DEAL_WON']);
/** Feedback event types that indicate negative outcomes. */
const NEGATIVE_EVENT_TYPES = new Set(['DEAL_LOST', 'UNSUBSCRIBED']);

/** Days after which a lead with no feedback is considered cold. */
const COLD_LEAD_TIMEOUT_DAYS = 30;
/** Minimum new labels before auto-enqueuing model.train. */
const RETRAIN_THRESHOLD = 50;

export async function handleLabelsGenerateJob(
  logger: LabelsGenerateLogger,
  job: Job<LabelsGenerateJobPayload>,
  deps?: LabelsGenerateJobDependencies,
): Promise<void> {
  const { runId, correlationId, from: rawFrom, to: rawTo, leadId, feedbackEventId } = job.data;

  // Compute the time window at runtime to avoid stale schedule payloads.
  // Schedule bakes from/to at boot time; by computing here we always get a fresh 24h window.
  const now = new Date();
  const effectiveTo = rawTo ? new Date(rawTo) : now;
  const effectiveFrom = rawFrom ? new Date(rawFrom) : new Date(now.getTime() - 86_400_000);

  // If schedule values are older than 2 hours, use fresh runtime values
  const isStale = now.getTime() - effectiveTo.getTime() > 2 * 60 * 60 * 1000;
  const from = isStale ? new Date(now.getTime() - 86_400_000) : effectiveFrom;
  const to = isStale ? now : effectiveTo;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: correlationId ?? job.id,
      from: from.toISOString(),
      to: to.toISOString(),
      stalePayloadOverridden: isStale,
      leadId,
      feedbackEventId,
    },
    'Started labels.generate job',
  );

  try {
    let newLabelCount = 0;

    // ── 1. Generate labels from feedback events ──────────────────────────
    const unlabeledEvents = await prisma.feedbackEvent.findMany({
      where: {
        ...(feedbackEventId ? { id: feedbackEventId } : {}),
        ...(leadId ? { leadId } : {}),
        createdAt: { gte: from, lte: to },
        trainingLabels: { none: {} },
      },
      select: { id: true, leadId: true, eventType: true },
    });

    for (const event of unlabeledEvents) {
      let label: number | null = null;
      if (POSITIVE_EVENT_TYPES.has(event.eventType)) {
        label = 1;
      } else if (NEGATIVE_EVENT_TYPES.has(event.eventType)) {
        label = 0;
      }

      if (label === null) continue;

      try {
        await prisma.trainingLabel.create({
          data: {
            leadId: event.leadId,
            feedbackEventId: event.id,
            label,
            source: 'FEEDBACK_EVENT',
          },
        });
        newLabelCount++;
      } catch (error: unknown) {
        // Skip unique constraint violations (duplicate labels)
        if (isPrismaUniqueConstraintError(error)) continue;
        throw error;
      }
    }

    // ── 2. Generate negative labels for cold leads ───────────────────────
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - COLD_LEAD_TIMEOUT_DAYS);

    const coldLeads = await prisma.messageSend.findMany({
      where: {
        status: 'SENT',
        sentAt: { lte: cutoffDate },
        lead: {
          deletedAt: null,
          feedbackEvents: { none: {} },
          trainingLabels: {
            none: { source: 'COLD_LEAD_TIMEOUT' },
          },
        },
      },
      select: { leadId: true },
      distinct: ['leadId'],
    });

    for (const cold of coldLeads) {
      try {
        await prisma.trainingLabel.create({
          data: {
            leadId: cold.leadId,
            feedbackEventId: null,
            label: 0,
            source: 'COLD_LEAD_TIMEOUT',
          },
        });
        newLabelCount++;
      } catch (error: unknown) {
        if (isPrismaUniqueConstraintError(error)) continue;
        throw error;
      }
    }

    if (newLabelCount >= RETRAIN_THRESHOLD) {
      logger.info(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          newLabelCount,
          threshold: RETRAIN_THRESHOLD,
        },
        'Retrain threshold reached, enqueuing model.train',
      );

      if (deps?.enqueueModelTrain) {
        const trainRunId = `labels-triggered-${runId}-${Date.now()}`;

        // Create the TrainingRun record BEFORE enqueuing, so model.train can
        // find it when it starts (it does prisma.trainingRun.update).
        const now = new Date();
        await prisma.trainingRun.create({
          data: {
            id: trainRunId,
            modelType: 'LOGISTIC_REGRESSION',
            status: 'QUEUED',
            trigger: 'FEEDBACK_THRESHOLD',
            configJson: {
              windowDays: 90,
              minSamples: 50,
              triggeredByLabelsRun: runId,
            },
            trainingWindowStart: new Date(now.getTime() - 90 * 86_400_000),
            trainingWindowEnd: now,
          },
        });

        const trainPayload = {
          runId: trainRunId,
          trainingRunId: trainRunId,
          trigger: 'FEEDBACK_THRESHOLD' as const,
          windowDays: 90,
          minSamples: 50,
          activateIfPass: true,
          correlationId: correlationId ?? job.id,
        } satisfies ModelTrainJobPayload;

        await deps.enqueueModelTrain(trainPayload);

        logger.info(
          {
            jobId: job.id,
            queue: job.name,
            runId,
            trainRunId,
            newLabelCount,
          },
          'Enqueued model.train due to label threshold',
        );
      }
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        newLabelCount,
        feedbackLabels: unlabeledEvents.length,
        coldLeadLabels: coldLeads.length,
      },
      'Completed labels.generate job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        error,
      },
      'Failed labels.generate job',
    );

    throw error;
  }
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}
