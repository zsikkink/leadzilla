import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';
import { recordPipelineEvent } from '../utils/pipeline-events.js';
import { getPipelineSettings } from '../utils/pipeline-settings.js';

export const LEAD_RECOVERY_JOB_NAME = 'lead.recovery';

export const LEAD_RECOVERY_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
  deadLetter: 'lead.recovery.dead_letter',
};

/** Batch size for recovery to avoid long transactions. */
const RECOVERY_BATCH_SIZE = 200;

export interface LeadRecoveryJobPayload {
  correlationId?: string | undefined;
}

export interface LeadRecoveryLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export async function handleLeadRecoveryJob(
  logger: LeadRecoveryLogger,
  job: Job<LeadRecoveryJobPayload>,
): Promise<void> {
  const settings = await getPipelineSettings();
  const cutoff = new Date(Date.now() - settings.stuckLeadThresholdMs);
  let totalRecovered = 0;

  logger.info(
    { jobId: job.id, cutoff: cutoff.toISOString(), thresholdMs: settings.stuckLeadThresholdMs },
    'Starting stuck lead recovery',
  );

  try {
    const stuckLeads = await prisma.lead.findMany({
      where: {
        status: 'processing',
        updatedAt: { lt: cutoff },
        deletedAt: null,
      },
      select: { id: true, email: true },
      take: RECOVERY_BATCH_SIZE,
    });

    for (const lead of stuckLeads) {
      try {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: 'failed',
            error: 'Stuck in processing for >1h, auto-recovered',
          },
        });

        totalRecovered += 1;

        await recordPipelineEvent({
          leadId: lead.id,
          stage: 'LEAD_RECOVERY',
          status: 'RECOVERED',
          jobId: job.id,
          metadata: { previousStatus: 'processing', thresholdMs: settings.stuckLeadThresholdMs },
        });

        logger.info(
          { jobId: job.id, leadId: lead.id, email: lead.email },
          'Recovered stuck lead',
        );
      } catch (updateError: unknown) {
        logger.error(
          {
            jobId: job.id,
            leadId: lead.id,
            error: formatErrorMessage(updateError),
          },
          'Failed to recover stuck lead — skipping',
        );
        // Continue with next lead
      }
    }

    logger.info(
      { jobId: job.id, totalRecovered, stuckFound: stuckLeads.length },
      'Stuck lead recovery complete',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        totalRecovered,
        error: formatErrorMessage(error),
      },
      'Stuck lead recovery failed',
    );
    // Terminal job — never throw
  }
}
