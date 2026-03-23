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

export const STALE_CLAIMED_FOLLOWUP_THRESHOLD_MS = 10 * 60 * 1000;

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

interface FollowupGenerationCandidate {
  id: string;
  leadId: string;
  followUpNumber: number;
  channel: 'EMAIL' | 'WHATSAPP';
  messageDraft: {
    icpProfileId: string;
  };
}

const TERMINAL_FOLLOW_UP_FEEDBACK_EVENT_TYPES = [
  'UNSUBSCRIBED',
  'MEETING_BOOKED',
  'DEAL_WON',
  'BOUNCED',
] satisfies Array<'UNSUBSCRIBED' | 'MEETING_BOOKED' | 'DEAL_WON' | 'BOUNCED'>;

function buildFollowupGeneratePayload(
  send: FollowupGenerationCandidate,
  previouslyPitchedFeatures: string[],
  correlationId: string,
): MessageGenerateJobPayload {
  return {
    runId: `followup:${send.id}:${send.followUpNumber + 1}`,
    leadId: send.leadId,
    icpProfileId: send.messageDraft.icpProfileId,
    followUpNumber: send.followUpNumber + 1,
    parentMessageSendId: send.id,
    previouslyPitchedFeatures,
    channel: send.channel,
    knowledgeEntryIds: [],
    promptVersion: 'v1-followup',
    correlationId,
  };
}

async function enqueueFollowupGeneration(
  boss: Pick<PgBoss, 'send'>,
  send: FollowupGenerationCandidate,
  previouslyPitchedFeatures: string[],
  correlationId: string,
): Promise<void> {
  const payload = buildFollowupGeneratePayload(send, previouslyPitchedFeatures, correlationId);

  await boss.send(
    MESSAGE_GENERATE_JOB_NAME,
    payload,
    {
      ...MESSAGE_GENERATE_RETRY_OPTIONS,
      singletonKey: `followup:${send.id}:${send.followUpNumber + 1}`,
    },
  );
}

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
    const staleClaimedBefore = new Date(now.getTime() - STALE_CLAIMED_FOLLOWUP_THRESHOLD_MS);
    const maxFollowUps = await getFollowUpMaxCount();
    const effectiveCorrelationId = correlationId ?? job.id;

    const [eligibleSends, staleClaimedSends] = await Promise.all([
      prisma.messageSend.findMany({
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
            },
          },
        },
        orderBy: { nextFollowUpAfter: 'asc' },
      }),
      prisma.messageSend.findMany({
        where: {
          status: 'SENT',
          followUpNumber: { lt: maxFollowUps },
          nextFollowUpAfter: null,
          updatedAt: { lt: staleClaimedBefore },
          lead: {
            deletedAt: null,
            status: 'messaged',
            feedbackEvents: {
              none: {
                eventType: { in: TERMINAL_FOLLOW_UP_FEEDBACK_EVENT_TYPES },
              },
            },
          },
          followUpDrafts: {
            none: {},
          },
        },
        select: {
          id: true,
          leadId: true,
          followUpNumber: true,
          channel: true,
          messageDraft: {
            select: {
              icpProfileId: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    // Batch-fetch previously pitched features for all eligible leads, scoped by ICP
    const leadIds = [...new Set([...eligibleSends, ...staleClaimedSends].map((s) => s.leadId))];
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
    let recoveredCount = 0;

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

      const previouslyPitchedFeatures =
        pitchedByLeadIcp.get(`${send.leadId}:${send.messageDraft.icpProfileId}`) ?? [];

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

      await enqueueFollowupGeneration(
        deps.boss,
        send,
        previouslyPitchedFeatures,
        effectiveCorrelationId,
      );

      enqueuedCount++;
    }

    // There is no remaining authoritative claim token after nextFollowUpAfter is
    // cleared, so recover only the narrow no-reply path by looking for stale
    // SENT/messaged parents with no child follow-up draft.
    for (const send of staleClaimedSends) {
      const previouslyPitchedFeatures =
        pitchedByLeadIcp.get(`${send.leadId}:${send.messageDraft.icpProfileId}`) ?? [];

      await enqueueFollowupGeneration(
        deps.boss,
        send,
        previouslyPitchedFeatures,
        effectiveCorrelationId,
      );

      recoveredCount++;
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        eligibleCount: eligibleSends.length,
        enqueuedCount,
        recoveredCount,
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
