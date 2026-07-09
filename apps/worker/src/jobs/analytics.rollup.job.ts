import {
  QUALIFIED_LEAD_STATUSES,
  SENT_MESSAGE_STATUSES,
  type RecomputeRollupRequest,
} from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

import { formatErrorMessage } from '../errors.js';

export const ANALYTICS_ROLLUP_JOB_NAME = 'analytics.rollup';
export const ANALYTICS_ROLLUP_IDEMPOTENCY_KEY_PATTERN = 'analytics.rollup:${day}:${icpProfileId || "all"}';

export const ANALYTICS_ROLLUP_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
  deadLetter: 'analytics.rollup.dead_letter',
};

export interface AnalyticsRollupJobPayload
  extends Pick<RecomputeRollupRequest, 'day' | 'icpProfileId' | 'fullRecompute' | 'requestedByUserId'> {
  runId: string;
  correlationId?: string;
}

export interface AnalyticsRollupLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

const NOT_INTERESTED_EVENT_TYPES = ['NOT_INTERESTED', 'UNSUBSCRIBED'] as const;

function parseDayRange(day: string): { dayStart: Date; dayEnd: Date } {
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  return { dayStart, dayEnd };
}

function isValidEmail(value: string): boolean {
  const [local, domain] = value.split('@');
  return Boolean(local && domain && domain.includes('.'));
}

function extractDomain(email: string): string | null {
  const [, domain] = email.split('@');
  if (!domain || !domain.includes('.')) {
    return null;
  }
  return domain.toLowerCase();
}

function toBooleanFeature(featuresJson: unknown, key: string): boolean {
  if (!featuresJson || typeof featuresJson !== 'object') {
    return false;
  }
  const value = (featuresJson as Record<string, unknown>)[key];
  return value === true;
}

function scoreBucketIndex(score: number): number {
  return Math.min(Math.max(Math.floor(score * 10), 0), 9);
}

export async function handleAnalyticsRollupJob(
  logger: AnalyticsRollupLogger,
  job: Job<AnalyticsRollupJobPayload>,
): Promise<void> {
  const { runId, correlationId, icpProfileId, fullRecompute } = job.data;

  // Compute day at runtime when the schedule sends 'auto' or an invalid value
  const rawDay = job.data.day;
  const day =
    rawDay && rawDay !== 'auto' && /^\d{4}-\d{2}-\d{2}$/.test(rawDay)
      ? rawDay
      : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: correlationId ?? job.id,
      day,
      rawDay,
      icpProfileId,
      fullRecompute,
    },
    'Started analytics.rollup job',
  );

  try {
    const { dayStart, dayEnd } = parseDayRange(day);
    const targetIcpIds = icpProfileId
      ? [icpProfileId]
      : (
          await prisma.icpProfile.findMany({
            where: { isActive: true },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          })
        ).map((row) => row.id);

    if (targetIcpIds.length === 0) {
      logger.warn(
        {
          jobId: job.id,
          queue: job.name,
          runId,
          correlationId: correlationId ?? job.id,
          day,
        },
        'Skipping analytics.rollup job because no ICP profiles were resolved',
      );
      return;
    }

    for (const targetIcpId of targetIcpIds) {
      const discoveryRows = await prisma.leadDiscoveryRecord.findMany({
        where: {
          icpProfileId: targetIcpId,
          discoveredAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
        select: {
          leadId: true,
          lead: {
            select: {
              email: true,
              status: true,
              costCents: true,
            },
          },
        },
      });

      const discoveredCount = discoveryRows.length;
      const leadsById = new Map(discoveryRows.map((row) => [row.leadId, row.lead]));
      const uniqueLeadIds = Array.from(leadsById.keys());
      const qualifiedStatuses = new Set<string>(QUALIFIED_LEAD_STATUSES);
      const qualifiedCount = Array.from(leadsById.values()).filter((lead) =>
        qualifiedStatuses.has(lead.status),
      ).length;
      const totalCostCents = Array.from(leadsById.values()).reduce((sum, lead) => sum + lead.costCents, 0);

      let validEmailCount = 0;
      const validDomains = new Set<string>();
      for (const row of discoveryRows) {
        if (isValidEmail(row.lead.email)) {
          validEmailCount += 1;
        }
        const domainFromEmail = extractDomain(row.lead.email);
        if (domainFromEmail) {
          validDomains.add(domainFromEmail);
        }
      }

      const enrichedCount =
        uniqueLeadIds.length === 0
          ? 0
          : await prisma.leadEnrichmentRecord.count({
              where: {
                leadId: {
                  in: uniqueLeadIds,
                },
                status: 'COMPLETED',
                OR: [
                  {
                    enrichedAt: {
                      gte: dayStart,
                      lt: dayEnd,
                    },
                  },
                  {
                    createdAt: {
                      gte: dayStart,
                      lt: dayEnd,
                    },
                  },
                ],
              },
            });

      const scoreRows = await prisma.leadScorePrediction.findMany({
        where: {
          icpProfileId: targetIcpId,
          predictedAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
        orderBy: [{ leadId: 'asc' }, { predictedAt: 'desc' }, { createdAt: 'desc' }],
        distinct: ['leadId'],
        select: {
          blendedScore: true,
          scoreBand: true,
        },
      });
      const scoredCount = scoreRows.length;
      const scoreSum = scoreRows.reduce((sum, row) => sum + row.blendedScore, 0);
      const lowScoreCount = scoreRows.filter((row) => row.scoreBand === 'LOW').length;
      const mediumScoreCount = scoreRows.filter((row) => row.scoreBand === 'MEDIUM').length;
      const highScoreCount = scoreRows.filter((row) => row.scoreBand === 'HIGH').length;
      const scoreBucketCounts = Array.from({ length: 10 }, () => 0);
      for (const row of scoreRows) {
        scoreBucketCounts[scoreBucketIndex(row.blendedScore)]! += 1;
      }

      const snapshots = await prisma.leadFeatureSnapshot.findMany({
        where: {
          icpProfileId: targetIcpId,
          computedAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
        select: {
          featuresJson: true,
        },
      });

      const snapshotCount = snapshots.length;
      const industryMatchCount = snapshots.filter((row) =>
        toBooleanFeature(row.featuresJson, 'industry_match'),
      ).length;
      const geoMatchCount = snapshots.filter((row) =>
        toBooleanFeature(row.featuresJson, 'geo_match'),
      ).length;

      const industryMatchRate =
        snapshotCount > 0 ? Number((industryMatchCount / snapshotCount).toFixed(6)) : 0;
      const geoMatchRate =
        snapshotCount > 0 ? Number((geoMatchCount / snapshotCount).toFixed(6)) : 0;

      // ── Bottom-of-funnel metrics ──────────────────────────────────────
      const messagesGeneratedCount = await prisma.messageDraft.count({
        where: {
          icpProfileId: targetIcpId,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      });

      const sentCount = await prisma.messageSend.count({
        where: {
          messageDraft: { icpProfileId: targetIcpId },
          status: { in: [...SENT_MESSAGE_STATUSES] },
          sentAt: { gte: dayStart, lt: dayEnd },
        },
      });

      const failedCount = await prisma.messageSend.count({
        where: {
          messageDraft: { icpProfileId: targetIcpId },
          status: 'FAILED',
          createdAt: { gte: dayStart, lt: dayEnd },
        },
      });

      const feedbackWhereBase = {
        occurredAt: { gte: dayStart, lt: dayEnd },
        lead: {
          discoveryRecords: {
            some: { icpProfileId: targetIcpId },
          },
        },
      };

      const [
        repliedCount,
        meetingsCount,
        dealsWonCount,
        dealLostCount,
        bouncedCount,
        notInterestedCount,
        rejectedCount,
      ] = await Promise.all([
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: 'REPLIED' },
        }),
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: 'MEETING_BOOKED' },
        }),
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: 'DEAL_WON' },
        }),
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: 'DEAL_LOST' },
        }),
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: 'BOUNCED' },
        }),
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: { in: [...NOT_INTERESTED_EVENT_TYPES] } },
        }),
        prisma.leadRejection.count({
          where: {
            icpProfileId: targetIcpId,
            rejectedAt: { gte: dayStart, lt: dayEnd },
          },
        }),
      ]);

      await prisma.analyticsDailyRollup.upsert({
        where: {
          day_icpProfileId: {
            day: dayStart,
            icpProfileId: targetIcpId,
          },
        },
        create: {
          day: dayStart,
          icpProfileId: targetIcpId,
          discoveredCount,
          qualifiedCount,
          enrichedCount,
          scoredCount,
          scoreSum,
          lowScoreCount,
          mediumScoreCount,
          highScoreCount,
          scoreBucket0Count: scoreBucketCounts[0] ?? 0,
          scoreBucket1Count: scoreBucketCounts[1] ?? 0,
          scoreBucket2Count: scoreBucketCounts[2] ?? 0,
          scoreBucket3Count: scoreBucketCounts[3] ?? 0,
          scoreBucket4Count: scoreBucketCounts[4] ?? 0,
          scoreBucket5Count: scoreBucketCounts[5] ?? 0,
          scoreBucket6Count: scoreBucketCounts[6] ?? 0,
          scoreBucket7Count: scoreBucketCounts[7] ?? 0,
          scoreBucket8Count: scoreBucketCounts[8] ?? 0,
          scoreBucket9Count: scoreBucketCounts[9] ?? 0,
          validEmailCount,
          validDomainCount: validDomains.size,
          industryMatchRate,
          geoMatchRate,
          messagesGeneratedCount,
          sentCount,
          failedCount,
          repliedCount,
          meetingsCount,
          dealsWonCount,
          dealLostCount,
          bouncedCount,
          notInterestedCount,
          rejectedCount,
          totalCostCents,
        },
        update: {
          discoveredCount,
          qualifiedCount,
          enrichedCount,
          scoredCount,
          scoreSum,
          lowScoreCount,
          mediumScoreCount,
          highScoreCount,
          scoreBucket0Count: scoreBucketCounts[0] ?? 0,
          scoreBucket1Count: scoreBucketCounts[1] ?? 0,
          scoreBucket2Count: scoreBucketCounts[2] ?? 0,
          scoreBucket3Count: scoreBucketCounts[3] ?? 0,
          scoreBucket4Count: scoreBucketCounts[4] ?? 0,
          scoreBucket5Count: scoreBucketCounts[5] ?? 0,
          scoreBucket6Count: scoreBucketCounts[6] ?? 0,
          scoreBucket7Count: scoreBucketCounts[7] ?? 0,
          scoreBucket8Count: scoreBucketCounts[8] ?? 0,
          scoreBucket9Count: scoreBucketCounts[9] ?? 0,
          validEmailCount,
          validDomainCount: validDomains.size,
          industryMatchRate,
          geoMatchRate,
          messagesGeneratedCount,
          sentCount,
          failedCount,
          repliedCount,
          meetingsCount,
          dealsWonCount,
          dealLostCount,
          bouncedCount,
          notInterestedCount,
          rejectedCount,
          totalCostCents,
        },
      });
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        day,
      },
      'Completed analytics.rollup job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: correlationId ?? job.id,
        day,
        error: formatErrorMessage(error),
      },
      'Failed analytics.rollup job',
    );

    throw error;
  }
}
