import type {
  IcpBreakdownItem,
  ManagerRecommendation,
  ScoreBandBreakdownItem,
  TrendComparison,
  VariantBreakdownItem,
} from '@lead-flood/contracts';
import { type Prisma, prisma } from '@lead-flood/db';
import type { Job, SendOptions } from 'pg-boss';

export const MANAGER_ANALYZE_JOB_NAME = 'manager.analyze';

export const MANAGER_ANALYZE_RETRY_OPTIONS: Pick<
  SendOptions,
  'retryLimit' | 'retryDelay' | 'retryBackoff' | 'deadLetter'
> = {
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
  deadLetter: 'manager.analyze.dead_letter',
};

export interface ManagerAnalyzeJobPayload {
  runId: string;
  correlationId?: string | undefined;
}

export interface ManagerAnalyzeLogger {
  info: (object: Record<string, unknown>, message: string) => void;
  warn: (object: Record<string, unknown>, message: string) => void;
  error: (object: Record<string, unknown>, message: string) => void;
}

const POSITIVE_EVENT_TYPES = ['REPLIED', 'MEETING_BOOKED', 'DEAL_WON'] as const;
const NEGATIVE_EVENT_TYPES = ['BOUNCED', 'UNSUBSCRIBED'] as const;

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function computeIcpBreakdown(
  weekStart: Date,
  weekEnd: Date,
): Promise<IcpBreakdownItem[]> {
  const icpProfiles = await prisma.icpProfile.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const results: IcpBreakdownItem[] = [];

  for (const icp of icpProfiles) {
    const sends = await prisma.messageSend.count({
      where: {
        sentAt: { gte: weekStart, lt: weekEnd },
        status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
        messageDraft: { icpProfileId: icp.id },
      },
    });

    if (sends === 0) continue;

    const [replies, positiveOutcomes, bounced] = await Promise.all([
      prisma.feedbackEvent.count({
        where: {
          occurredAt: { gte: weekStart, lt: weekEnd },
          eventType: 'REPLIED',
          messageSend: { messageDraft: { icpProfileId: icp.id } },
        },
      }),
      prisma.feedbackEvent.count({
        where: {
          occurredAt: { gte: weekStart, lt: weekEnd },
          eventType: { in: ['MEETING_BOOKED', 'DEAL_WON'] },
          messageSend: { messageDraft: { icpProfileId: icp.id } },
        },
      }),
      prisma.feedbackEvent.count({
        where: {
          occurredAt: { gte: weekStart, lt: weekEnd },
          eventType: { in: ['BOUNCED', 'UNSUBSCRIBED'] },
          messageSend: { messageDraft: { icpProfileId: icp.id } },
        },
      }),
    ]);

    results.push({
      icpProfileId: icp.id,
      icpName: icp.name,
      sends,
      replies,
      positiveOutcomes,
      bounced,
      replyRate: safeRate(replies, sends),
      positiveRate: safeRate(positiveOutcomes, sends),
      bounceRate: safeRate(bounced, sends),
    });
  }

  return results;
}

async function computeVariantBreakdown(
  weekStart: Date,
  weekEnd: Date,
): Promise<VariantBreakdownItem[]> {
  const variantSends = await prisma.messageSend.findMany({
    where: {
      sentAt: { gte: weekStart, lt: weekEnd },
      status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
    },
    select: {
      id: true,
      messageVariant: {
        select: { variantKey: true, channel: true },
      },
    },
  });

  const variantMap = new Map<string, { channel: string; sends: number; replies: number }>();

  for (const send of variantSends) {
    const key = send.messageVariant.variantKey;
    const existing = variantMap.get(key);
    if (existing) {
      existing.sends += 1;
    } else {
      variantMap.set(key, {
        channel: send.messageVariant.channel,
        sends: 1,
        replies: 0,
      });
    }
  }

  // Count replies per variant
  const sendIds = variantSends.map((s) => s.id);
  if (sendIds.length > 0) {
    const replyEvents = await prisma.feedbackEvent.findMany({
      where: {
        occurredAt: { gte: weekStart, lt: weekEnd },
        eventType: 'REPLIED',
        messageSendId: { in: sendIds },
      },
      select: {
        messageSend: {
          select: {
            messageVariant: { select: { variantKey: true } },
          },
        },
      },
    });

    for (const event of replyEvents) {
      const key = event.messageSend?.messageVariant.variantKey;
      if (key) {
        const existing = variantMap.get(key);
        if (existing) {
          existing.replies += 1;
        }
      }
    }
  }

  const results: VariantBreakdownItem[] = [];
  for (const [variantKey, data] of variantMap) {
    results.push({
      variantKey,
      channel: data.channel,
      sends: data.sends,
      replies: data.replies,
      replyRate: safeRate(data.replies, data.sends),
    });
  }

  return results.sort((a, b) => b.replyRate - a.replyRate);
}

async function computeScoreBandBreakdown(
  weekStart: Date,
  weekEnd: Date,
): Promise<ScoreBandBreakdownItem[]> {
  const bands = ['HIGH', 'MEDIUM', 'LOW'] as const;
  const results: ScoreBandBreakdownItem[] = [];

  for (const band of bands) {
    const sends = await prisma.messageSend.count({
      where: {
        sentAt: { gte: weekStart, lt: weekEnd },
        status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
        messageDraft: {
          scorePrediction: { scoreBand: band },
        },
      },
    });

    if (sends === 0) {
      results.push({
        scoreBand: band,
        sends: 0,
        replies: 0,
        replyRate: 0,
        positiveOutcomes: 0,
        positiveRate: 0,
      });
      continue;
    }

    const [replies, positiveOutcomes] = await Promise.all([
      prisma.feedbackEvent.count({
        where: {
          occurredAt: { gte: weekStart, lt: weekEnd },
          eventType: 'REPLIED',
          messageSend: {
            messageDraft: {
              scorePrediction: { scoreBand: band },
            },
          },
        },
      }),
      prisma.feedbackEvent.count({
        where: {
          occurredAt: { gte: weekStart, lt: weekEnd },
          eventType: { in: ['MEETING_BOOKED', 'DEAL_WON'] },
          messageSend: {
            messageDraft: {
              scorePrediction: { scoreBand: band },
            },
          },
        },
      }),
    ]);

    results.push({
      scoreBand: band,
      sends,
      replies,
      replyRate: safeRate(replies, sends),
      positiveOutcomes,
      positiveRate: safeRate(positiveOutcomes, sends),
    });
  }

  return results;
}

async function computeWeekMetrics(
  weekStart: Date,
  weekEnd: Date,
): Promise<{ sends: number; replies: number; positive: number; bounced: number }> {
  const [sends, replies, positive, bounced] = await Promise.all([
    prisma.messageSend.count({
      where: {
        sentAt: { gte: weekStart, lt: weekEnd },
        status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
      },
    }),
    prisma.feedbackEvent.count({
      where: {
        occurredAt: { gte: weekStart, lt: weekEnd },
        eventType: 'REPLIED',
      },
    }),
    prisma.feedbackEvent.count({
      where: {
        occurredAt: { gte: weekStart, lt: weekEnd },
        eventType: { in: [...POSITIVE_EVENT_TYPES] },
      },
    }),
    prisma.feedbackEvent.count({
      where: {
        occurredAt: { gte: weekStart, lt: weekEnd },
        eventType: { in: [...NEGATIVE_EVENT_TYPES] },
      },
    }),
  ]);

  return { sends, replies, positive, bounced };
}

function generateRecommendations(
  icpBreakdown: IcpBreakdownItem[],
  variantBreakdown: VariantBreakdownItem[],
  scoreBandBreakdown: ScoreBandBreakdownItem[],
  trend: TrendComparison,
): ManagerRecommendation[] {
  const recommendations: ManagerRecommendation[] = [];

  // 1. Flag ICPs with high bounce rate (>15%)
  for (const icp of icpBreakdown) {
    if (icp.sends >= 5 && icp.bounceRate > 0.15) {
      recommendations.push({
        type: 'PAUSE_ICP',
        icpProfileId: icp.icpProfileId,
        field: 'bounceRate',
        currentValue: icp.bounceRate,
        recommendedValue: null,
        confidence: Math.min(0.9, 0.5 + icp.sends * 0.02),
        reasoning: `ICP "${icp.icpName}" has a ${(icp.bounceRate * 100).toFixed(1)}% bounce rate over ${icp.sends} sends. Consider pausing outreach or verifying email quality for this segment.`,
      });
    }
  }

  // 2. Flag ICPs with zero replies on meaningful volume
  for (const icp of icpBreakdown) {
    if (icp.sends >= 10 && icp.replies === 0) {
      recommendations.push({
        type: 'PAUSE_ICP',
        icpProfileId: icp.icpProfileId,
        field: 'replyRate',
        currentValue: 0,
        recommendedValue: null,
        confidence: Math.min(0.85, 0.5 + icp.sends * 0.015),
        reasoning: `ICP "${icp.icpName}" has 0 replies across ${icp.sends} sends. Review targeting criteria or messaging for this profile.`,
      });
    }
  }

  // 3. Compare HIGH vs MEDIUM score band performance
  const highBand = scoreBandBreakdown.find((b) => b.scoreBand === 'HIGH');
  const mediumBand = scoreBandBreakdown.find((b) => b.scoreBand === 'MEDIUM');

  if (highBand && mediumBand && highBand.sends >= 5 && mediumBand.sends >= 5) {
    // If MEDIUM actually performs better than HIGH, threshold may be wrong
    if (mediumBand.replyRate > highBand.replyRate && mediumBand.replyRate > 0) {
      recommendations.push({
        type: 'ADJUST_THRESHOLD',
        icpProfileId: null,
        field: 'scoringThreshold',
        currentValue: 0.5,
        recommendedValue: 0.4,
        confidence: 0.6,
        reasoning: `MEDIUM band reply rate (${(mediumBand.replyRate * 100).toFixed(1)}%) exceeds HIGH band (${(highBand.replyRate * 100).toFixed(1)}%). The scoring threshold may be miscalibrated — consider lowering it to capture these responsive leads.`,
      });
    }

    // If HIGH has low positive rate, scoring weights may need adjustment
    if (highBand.positiveRate < 0.02 && highBand.sends >= 10) {
      recommendations.push({
        type: 'ADJUST_WEIGHT',
        icpProfileId: null,
        field: 'deterministicWeight',
        currentValue: 0.6,
        recommendedValue: 0.5,
        confidence: 0.55,
        reasoning: `HIGH-scored leads have only ${(highBand.positiveRate * 100).toFixed(1)}% positive outcome rate. Deterministic scoring factors may be overweighted relative to actual conversion signals.`,
      });
    }
  }

  // 4. If MEDIUM band performs well, recommend increasing volume
  if (mediumBand && mediumBand.sends >= 5 && mediumBand.replyRate > 0.05) {
    recommendations.push({
      type: 'INCREASE_VOLUME',
      icpProfileId: null,
      field: 'scoringThreshold',
      currentValue: 0.5,
      recommendedValue: 0.35,
      confidence: 0.5,
      reasoning: `MEDIUM band shows ${(mediumBand.replyRate * 100).toFixed(1)}% reply rate across ${mediumBand.sends} sends. Lowering the qualification threshold could increase volume without sacrificing response quality.`,
    });
  }

  // 5. Week-over-week decline warning
  if (
    trend.currentWeek.sends >= 10 &&
    trend.previousWeek.sends >= 10 &&
    trend.replyRateDelta < -0.05
  ) {
    recommendations.push({
      type: 'ADJUST_WEIGHT',
      icpProfileId: null,
      field: 'replyRateTrend',
      currentValue: trend.currentWeek.replyRate,
      recommendedValue: null,
      confidence: 0.65,
      reasoning: `Reply rate dropped ${(Math.abs(trend.replyRateDelta) * 100).toFixed(1)} percentage points week-over-week (${(trend.previousWeek.replyRate * 100).toFixed(1)}% → ${(trend.currentWeek.replyRate * 100).toFixed(1)}%). Investigate messaging quality or deliverability issues.`,
    });
  }

  // 6. Variant A/B insights — flag underperforming variants
  if (variantBreakdown.length >= 2) {
    const sorted = [...variantBreakdown].sort((a, b) => b.replyRate - a.replyRate);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;

    if (
      best.sends >= 5 &&
      worst.sends >= 5 &&
      best.replyRate - worst.replyRate > 0.05
    ) {
      recommendations.push({
        type: 'ADJUST_WEIGHT',
        icpProfileId: null,
        field: `variant:${worst.variantKey}`,
        currentValue: worst.replyRate,
        recommendedValue: null,
        confidence: Math.min(0.8, 0.4 + (best.sends + worst.sends) * 0.01),
        reasoning: `Variant "${best.variantKey}" outperforms "${worst.variantKey}" by ${((best.replyRate - worst.replyRate) * 100).toFixed(1)} percentage points (${(best.replyRate * 100).toFixed(1)}% vs ${(worst.replyRate * 100).toFixed(1)}%). Consider retiring the underperforming variant.`,
      });
    }
  }

  return recommendations;
}

export async function handleManagerAnalyzeJob(
  logger: ManagerAnalyzeLogger,
  job: Job<ManagerAnalyzeJobPayload>,
): Promise<void> {
  const { runId, correlationId } = job.data;
  const effectiveCorrelationId = correlationId ?? job.id;

  logger.info(
    {
      jobId: job.id,
      queue: job.name,
      runId,
      correlationId: effectiveCorrelationId,
    },
    'Started manager.analyze job',
  );

  try {
    // Compute time windows: current week = last 7 days, previous week = 7-14 days ago
    const now = new Date();
    const weekEnd = now;
    const weekStart = new Date(now.getTime() - ONE_WEEK_MS);
    const prevWeekStart = new Date(weekStart.getTime() - ONE_WEEK_MS);

    // Run analysis in parallel
    const [
      currentMetrics,
      prevMetrics,
      icpBreakdown,
      variantBreakdown,
      scoreBandBreakdown,
    ] = await Promise.all([
      computeWeekMetrics(weekStart, weekEnd),
      computeWeekMetrics(prevWeekStart, weekStart),
      computeIcpBreakdown(weekStart, weekEnd),
      computeVariantBreakdown(weekStart, weekEnd),
      computeScoreBandBreakdown(weekStart, weekEnd),
    ]);

    const currentReplyRate = safeRate(currentMetrics.replies, currentMetrics.sends);
    const currentPositiveRate = safeRate(currentMetrics.positive, currentMetrics.sends);
    const currentBounceRate = safeRate(currentMetrics.bounced, currentMetrics.sends);

    const prevReplyRate = safeRate(prevMetrics.replies, prevMetrics.sends);
    const prevPositiveRate = safeRate(prevMetrics.positive, prevMetrics.sends);
    const prevBounceRate = safeRate(prevMetrics.bounced, prevMetrics.sends);

    const trend: TrendComparison = {
      currentWeek: {
        replyRate: currentReplyRate,
        positiveRate: currentPositiveRate,
        bounceRate: currentBounceRate,
        sends: currentMetrics.sends,
      },
      previousWeek: {
        replyRate: prevReplyRate,
        positiveRate: prevPositiveRate,
        bounceRate: prevBounceRate,
        sends: prevMetrics.sends,
      },
      replyRateDelta: currentReplyRate - prevReplyRate,
      positiveRateDelta: currentPositiveRate - prevPositiveRate,
      bounceRateDelta: currentBounceRate - prevBounceRate,
    };

    const recommendations = generateRecommendations(
      icpBreakdown,
      variantBreakdown,
      scoreBandBreakdown,
      trend,
    );

    // Persist analysis
    await prisma.managerAnalysis.create({
      data: {
        runId,
        weekStart,
        weekEnd,
        totalSends: currentMetrics.sends,
        totalReplies: currentMetrics.replies,
        totalPositive: currentMetrics.positive,
        totalBounced: currentMetrics.bounced,
        overallReplyRate: currentReplyRate,
        overallPositiveRate: currentPositiveRate,
        overallBounceRate: currentBounceRate,
        icpBreakdownJson: toInputJson(icpBreakdown),
        variantBreakdownJson: toInputJson(variantBreakdown),
        scoreBandBreakdownJson: toInputJson(scoreBandBreakdown),
        trendJson: toInputJson(trend),
        recommendationsJson: toInputJson(recommendations),
        recommendationCount: recommendations.length,
      },
    });

    // Log each recommendation for visibility
    for (const rec of recommendations) {
      logger.info(
        {
          jobId: job.id,
          runId,
          recommendationType: rec.type,
          icpProfileId: rec.icpProfileId,
          field: rec.field,
          confidence: rec.confidence,
        },
        `Recommendation: ${rec.reasoning}`,
      );
    }

    logger.info(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        totalSends: currentMetrics.sends,
        totalReplies: currentMetrics.replies,
        totalPositive: currentMetrics.positive,
        totalBounced: currentMetrics.bounced,
        replyRate: currentReplyRate,
        positiveRate: currentPositiveRate,
        bounceRate: currentBounceRate,
        icpCount: icpBreakdown.length,
        variantCount: variantBreakdown.length,
        recommendationCount: recommendations.length,
        replyRateDelta: trend.replyRateDelta,
      },
      'Completed manager.analyze job',
    );
  } catch (error: unknown) {
    logger.error(
      {
        jobId: job.id,
        queue: job.name,
        runId,
        correlationId: effectiveCorrelationId,
        error,
      },
      'Failed manager.analyze job',
    );

    throw error;
  }
}
