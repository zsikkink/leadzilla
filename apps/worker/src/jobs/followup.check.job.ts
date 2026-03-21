import { prisma } from '@lead-flood/db';
import type PgBoss from 'pg-boss';
import type { Job, SendOptions } from 'pg-boss';

import {
  MESSAGE_GENERATE_JOB_NAME,
  MESSAGE_GENERATE_RETRY_OPTIONS,
  type MessageGenerateJobPayload,
} from './message.generate.job.js';
import { getFollowUpMaxCount } from '../utils/pipeline-settings.js';

export const FOLLOWUP_CHECK_JOB_NAME = 'followup.check';

export const FOLLOWUP_CHECK_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 30,
  retryBackoff: true,
  deadLetter: 'followup.check.dead_letter',
};

export interface FollowupCheckJobPayload {
  runId: string;
  correlationId?: string | undefined;
}

export interface FollowupCheckLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

export interface FollowupCheckJobDependencies {
  boss: Pick<PgBoss, 'send'>;
}

const TERMINAL_FOLLOW_UP_FEEDBACK_EVENT_TYPES = [
  'UNSUBSCRIBED',
  'MEETING_BOOKED',
  'DEAL_WON',
  'BOUNCED',
] satisfies Array<'UNSUBSCRIBED' | 'MEETING_BOOKED' | 'DEAL_WON' | 'BOUNCED'>;

export async function handleFollowupCheckJob(
  logger: FollowupCheckLogger,
  job: Job<FollowupCheckJobPayload>,
  deps: FollowupCheckJobDependencies,
): Promise<void> {
  const { runId, correlationId } = job.data;

  logger.info(
    { jobId: job.id, queue: job.name, runId, correlationId: correlationId ?? job.id },
    'Started followup.check job',
  );

  try {
    const now = new Date();
    const maxFollowUps = await getFollowUpMaxCount();

    // Find all MessageSends eligible for follow-up
    const eligibleSends = await prisma.messageSend.findMany({
      where: {
        status: { in: ['SENT', 'REPLIED'] },
        followUpNumber: { lt: maxFollowUps },
        nextFollowUpAfter: { not: null, lte: now },
        lead: {
          deletedAt: null,
          status: { in: ['messaged', 'replied'] },
        },
      },
      select: {
        id: true,
        leadId: true,
        followUpNumber: true,
        channel: true,
        lead: {
          select: {
            id: true,
            feedbackEvents: {
              // REPLIED is intentionally excluded so OUT_OF_OFFICE responses can
              // reschedule follow-ups via reply.classify without being canceled.
              where: { eventType: { in: TERMINAL_FOLLOW_UP_FEEDBACK_EVENT_TYPES } },
              select: { id: true },
              take: 1,
            },
          },
        },
        messageDraft: {
          select: {
            icpProfileId: true,
            pitchedFeature: true,
          },
        },
      },
      orderBy: { nextFollowUpAfter: 'asc' },
    });

    // Batch-fetch previously pitched features for all eligible leads, scoped by ICP
    const leadIds = [...new Set(eligibleSends.map((s) => s.leadId))];
    const allPreviousDrafts = leadIds.length > 0
      ? await prisma.messageDraft.findMany({
          where: { leadId: { in: leadIds }, pitchedFeature: { not: null } },
          select: { leadId: true, icpProfileId: true, pitchedFeature: true },
        })
      : [];
    // Key: `${leadId}:${icpProfileId}` → pitched features for that lead+ICP pair
    const pitchedByLeadIcp = new Map<string, string[]>();
    for (const d of allPreviousDrafts) {
      if (d.pitchedFeature) {
        const key = `${d.leadId}:${d.icpProfileId}`;
        const list = pitchedByLeadIcp.get(key) ?? [];
        list.push(d.pitchedFeature);
        pitchedByLeadIcp.set(key, list);
      }
    }

    let enqueuedCount = 0;

    for (const send of eligibleSends) {
      // Double-check: no terminal feedback events
      if (send.lead.feedbackEvents.length > 0) {
        // Stale data — cancel this follow-up
        await prisma.messageSend.updateMany({
          where: {
            id: send.id,
            nextFollowUpAfter: { not: null },
            lead: {
              feedbackEvents: {
                some: {
                  eventType: { in: TERMINAL_FOLLOW_UP_FEEDBACK_EVENT_TYPES },
                },
              },
            },
          },
          data: { nextFollowUpAfter: null },
        });
        continue;
      }

      const icpProfileId = send.messageDraft.icpProfileId;
      const previouslyPitchedFeatures = pitchedByLeadIcp.get(`${send.leadId}:${icpProfileId}`) ?? [];

      // Claim the follow-up slot before enqueueing so stale or concurrent
      // workers cannot schedule the same downstream message.generate twice.
      const claimResult = await prisma.messageSend.updateMany({
        where: {
          id: send.id,
          status: { in: ['SENT', 'REPLIED'] },
          followUpNumber: send.followUpNumber,
          nextFollowUpAfter: { not: null, lte: now },
          lead: {
            deletedAt: null,
            status: { in: ['messaged', 'replied'] },
            feedbackEvents: {
              none: {
                eventType: { in: TERMINAL_FOLLOW_UP_FEEDBACK_EVENT_TYPES },
              },
            },
          },
        },
        data: { nextFollowUpAfter: null },
      });

      if (claimResult.count === 0) {
        logger.info(
          { jobId: job.id, sendId: send.id, leadId: send.leadId },
          'Follow-up send no longer eligible, skipping stale follow-up candidate',
        );
        continue;
      }

      // Enqueue message.generate in follow-up mode
      await deps.boss.send(
        MESSAGE_GENERATE_JOB_NAME,
        {
          runId: `followup:${send.id}:${send.followUpNumber + 1}`,
          leadId: send.leadId,
          icpProfileId,
          followUpNumber: send.followUpNumber + 1,
          parentMessageSendId: send.id,
          previouslyPitchedFeatures,
          channel: send.channel,
          knowledgeEntryIds: [],
          promptVersion: 'v1-followup',
          correlationId: correlationId ?? job.id,
        } satisfies MessageGenerateJobPayload,
        {
          ...MESSAGE_GENERATE_RETRY_OPTIONS,
          singletonKey: `followup:${send.id}:${send.followUpNumber + 1}`,
        },
      );

      enqueuedCount++;
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        eligibleCount: eligibleSends.length,
        enqueuedCount,
      },
      'Completed followup.check job',
    );
  } catch (error: unknown) {
    logger.error(
      { jobId: job.id, queue: job.name, runId, error },
      'Failed followup.check job',
    );
    throw error;
  }
}
