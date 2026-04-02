import type {
  IcpBreakdownItem,
  ManagerRecommendation,
  ScoreBandBreakdownItem,
  TrendComparison,
  VariantBreakdownItem,
} from '@lead-flood/contracts';
import { prisma } from '@lead-flood/db';
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
const NEGATIVE_EVENT_TYPES = new Set(['BOUNCED', 'NOT_INTERESTED', 'UNSUBSCRIBED', 'DEAL_LOST']);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

// ── Chi-squared test for A/B significance ───────────────────
function chiSquaredTest(
  successA: number,
  totalA: number,
  successB: number,
  totalB: number,
): { chiSquared: number; pValue: string; significant: boolean } {
  const failA = totalA - successA;
  const failB = totalB - successB;
  const total = totalA + totalB;
  const totalSuccess = successA + successB;
  const totalFail = failA + failB;

  if (total === 0 || totalSuccess === 0 || totalFail === 0) {
    return { chiSquared: 0, pValue: '1.00', significant: false };
  }

  const expectedSuccessA = (totalA * totalSuccess) / total;
  const expectedFailA = (totalA * totalFail) / total;
  const expectedSuccessB = (totalB * totalSuccess) / total;
  const expectedFailB = (totalB * totalFail) / total;

  const chi2 =
    ((successA - expectedSuccessA) ** 2) / expectedSuccessA +
    ((failA - expectedFailA) ** 2) / expectedFailA +
    ((successB - expectedSuccessB) ** 2) / expectedSuccessB +
    ((failB - expectedFailB) ** 2) / expectedFailB;

  // p-value approximation using chi-squared CDF (1 df)
  // For 1 degree of freedom: p ≈ erfc(sqrt(chi2/2))
  // Use simple thresholds: chi2 > 3.841 → p < 0.05 (significant)
  const significant = chi2 > 3.841;
  let pValue: string;
  if (chi2 > 10.828) pValue = '<0.001';
  else if (chi2 > 6.635) pValue = '<0.01';
  else if (chi2 > 3.841) pValue = '<0.05';
  else if (chi2 > 2.706) pValue = '<0.10';
  else pValue = '>0.10';

  return {
    chiSquared: Math.round(chi2 * 100) / 100,
    pValue,
    significant,
  };
}

// ── Data queries ────────────────────────────────────────────

async function computeIcpBreakdown(
  weekStart: Date,
  weekEnd: Date,
): Promise<IcpBreakdownItem[]> {
  const icpProfiles = await prisma.icpProfile.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const sendCounts = await Promise.all(
    icpProfiles.map((icp) =>
      prisma.messageSend.count({
        where: {
          sentAt: { gte: weekStart, lt: weekEnd },
          status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
          messageDraft: { icpProfileId: icp.id },
        },
      }),
    ),
  );

  const activeIcps = icpProfiles
    .map((icp, i) => ({ ...icp, sends: sendCounts[i]! }))
    .filter((icp) => icp.sends > 0);

  const feedbackCounts = await Promise.all(
    activeIcps.map((icp) =>
      Promise.all([
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
        prisma.feedbackEvent.findMany({
          where: {
            occurredAt: { gte: weekStart, lt: weekEnd },
            messageSend: { messageDraft: { icpProfileId: icp.id } },
          },
          select: { eventType: true },
        }),
      ]),
    ),
  );

  return activeIcps.map((icp, i) => {
    const [replies, positiveOutcomes, negativeEvents] = feedbackCounts[i]!;
    const bounced = negativeEvents.filter((event) => NEGATIVE_EVENT_TYPES.has(event.eventType)).length;
    return {
      icpProfileId: icp.id,
      icpName: icp.name,
      sends: icp.sends,
      replies,
      positiveOutcomes,
      bounced,
      replyRate: safeRate(replies, icp.sends),
      positiveRate: safeRate(positiveOutcomes, icp.sends),
      bounceRate: safeRate(bounced, icp.sends),
    };
  });
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

  const sendCounts = await Promise.all(
    bands.map((band) =>
      prisma.messageSend.count({
        where: {
          sentAt: { gte: weekStart, lt: weekEnd },
          status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
          messageDraft: {
            scorePrediction: { scoreBand: band },
          },
        },
      }),
    ),
  );

  const feedbackCounts = await Promise.all(
    bands.map((band, i) => {
      if (sendCounts[i] === 0) return Promise.resolve([0, 0] as const);
      return Promise.all([
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
    }),
  );

  return bands.map((band, i) => {
    const sends = sendCounts[i]!;
    const [replies, positiveOutcomes] = feedbackCounts[i]!;
    return {
      scoreBand: band,
      sends,
      replies,
      replyRate: safeRate(replies, sends),
      positiveOutcomes,
      positiveRate: safeRate(positiveOutcomes, sends),
    };
  });
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
    prisma.feedbackEvent.findMany({
      where: {
        occurredAt: { gte: weekStart, lt: weekEnd },
      },
      select: { eventType: true },
    }),
  ]);

  return {
    sends,
    replies,
    positive,
    bounced: bounced.filter((event) => NEGATIVE_EVENT_TYPES.has(event.eventType)).length,
  };
}

// ── Deal loss analysis per ICP ───────────────────────────────

interface IcpDealLossItem {
  icpProfileId: string;
  icpName: string;
  dealWon: number;
  dealLost: number;
  dealLossRate: number;
  totalDeals: number;
}

async function computeIcpDealLoss(
  weekStart: Date,
  weekEnd: Date,
): Promise<IcpDealLossItem[]> {
  const icpProfiles = await prisma.icpProfile.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const dealCounts = await Promise.all(
    icpProfiles.map((icp) =>
      Promise.all([
        prisma.feedbackEvent.count({
          where: {
            occurredAt: { gte: weekStart, lt: weekEnd },
            eventType: 'DEAL_WON',
            messageSend: { messageDraft: { icpProfileId: icp.id } },
          },
        }),
        prisma.feedbackEvent.count({
          where: {
            occurredAt: { gte: weekStart, lt: weekEnd },
            eventType: 'DEAL_LOST',
            messageSend: { messageDraft: { icpProfileId: icp.id } },
          },
        }),
      ]),
    ),
  );

  return icpProfiles
    .map((icp, i) => {
      const [dealWon, dealLost] = dealCounts[i]!;
      const totalDeals = dealWon + dealLost;
      return {
        icpProfileId: icp.id,
        icpName: icp.name,
        dealWon,
        dealLost,
        dealLossRate: safeRate(dealLost, totalDeals),
        totalDeals,
      };
    })
    .filter((item) => item.totalDeals > 0);
}

// ── Discovery yield analysis ────────────────────────────────

async function computeDiscoveryYield(): Promise<{
  icpYieldRates: Array<{ icpProfileId: string; icpName: string; yieldRate: number; totalDiscovered: number; totalLeads: number }>;
}> {
  // Scope to last 30 days so yield reflects recent ICP config / search category changes,
  // not diluted by lifetime historical data
  const windowStart = new Date(Date.now() - THIRTY_DAYS_MS);

  const icpProfiles = await prisma.icpProfile.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const results = await Promise.all(
    icpProfiles.map(async (icp) => {
      // Count discovery records and leads per ICP within the 30-day window
      const [totalDiscovered, totalLeads] = await Promise.all([
        prisma.leadDiscoveryRecord.count({
          where: {
            icpProfileId: icp.id,
            status: 'DISCOVERED',
            createdAt: { gte: windowStart },
          },
        }),
        prisma.lead.count({
          where: {
            createdAt: { gte: windowStart },
            discoveryRecords: {
              some: { icpProfileId: icp.id },
            },
          },
        }),
      ]);

      return {
        icpProfileId: icp.id,
        icpName: icp.name,
        yieldRate: safeRate(totalLeads, totalDiscovered),
        totalDiscovered,
        totalLeads,
      };
    }),
  );

  return { icpYieldRates: results };
}

// ── Recommendation generator ────────────────────────────────

function generateRecommendations(
  icpBreakdown: IcpBreakdownItem[],
  variantBreakdown: VariantBreakdownItem[],
  scoreBandBreakdown: ScoreBandBreakdownItem[],
  trend: TrendComparison,
  discoveryYield: { icpYieldRates: Array<{ icpProfileId: string; icpName: string; yieldRate: number; totalDiscovered: number; totalLeads: number }> },
  icpDealLoss: IcpDealLossItem[],
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
    if (mediumBand.replyRate > highBand.replyRate && mediumBand.replyRate > 0) {
      const bandTest = chiSquaredTest(mediumBand.replies, mediumBand.sends, highBand.replies, highBand.sends);
      const significanceNote = bandTest.significant
        ? ` (statistically significant: p=${bandTest.pValue}, chi2=${bandTest.chiSquared})`
        : ` (not yet statistically significant: p=${bandTest.pValue}, needs more data)`;

      recommendations.push({
        type: 'ADJUST_THRESHOLD',
        icpProfileId: null,
        field: 'scoringThreshold',
        currentValue: 0.5,
        recommendedValue: 0.4,
        confidence: bandTest.significant ? 0.7 : 0.4,
        reasoning: `MEDIUM band reply rate (${(mediumBand.replyRate * 100).toFixed(1)}%) exceeds HIGH band (${(highBand.replyRate * 100).toFixed(1)}%)${significanceNote}. The scoring threshold may be miscalibrated.`,
      });
    }

    if (highBand.positiveRate < 0.02 && highBand.sends >= 10) {
      recommendations.push({
        type: 'ADJUST_WEIGHT',
        icpProfileId: null,
        field: 'deterministicWeight',
        currentValue: 0.6,
        recommendedValue: 0.5,
        confidence: 0.55,
        reasoning: `HIGH-scored leads have only ${(highBand.positiveRate * 100).toFixed(1)}% positive outcome rate. Deterministic scoring factors may be overweighted.`,
      });
    }
  }

  // 4. MEDIUM band performing well → increase volume
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
      reasoning: `Reply rate dropped ${(Math.abs(trend.replyRateDelta) * 100).toFixed(1)} percentage points week-over-week (${(trend.previousWeek.replyRate * 100).toFixed(1)}% to ${(trend.currentWeek.replyRate * 100).toFixed(1)}%). Investigate messaging quality or deliverability issues.`,
    });
  }

  // 6. Variant A/B insights (chi-squared gated)
  if (variantBreakdown.length >= 2) {
    const sorted = [...variantBreakdown].sort((a, b) => b.replyRate - a.replyRate);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;

    if (
      best.sends >= 5 &&
      worst.sends >= 5 &&
      best.replyRate - worst.replyRate > 0.05
    ) {
      const abTest = chiSquaredTest(best.replies, best.sends, worst.replies, worst.sends);

      if (abTest.significant) {
        recommendations.push({
          type: 'PREFER_VARIANT',
          icpProfileId: null,
          field: `variant:${worst.variantKey}`,
          currentValue: worst.replyRate,
          recommendedValue: null,
          confidence: Math.min(0.9, 0.5 + (best.sends + worst.sends) * 0.01),
          reasoning: `Variant "${best.variantKey}" outperforms "${worst.variantKey}" by ${((best.replyRate - worst.replyRate) * 100).toFixed(1)} percentage points (${(best.replyRate * 100).toFixed(1)}% vs ${(worst.replyRate * 100).toFixed(1)}%, p=${abTest.pValue}). Consider retiring the underperforming variant.`,
        });
      }
    }
  }

  // 7. Discovery yield analysis — low-yield ICPs
  for (const yieldItem of discoveryYield.icpYieldRates) {
    if (yieldItem.totalDiscovered >= 20 && yieldItem.yieldRate < 0.03) {
      recommendations.push({
        type: 'SWITCH_SOURCE',
        icpProfileId: yieldItem.icpProfileId,
        field: 'discoveryYieldRate',
        currentValue: yieldItem.yieldRate,
        recommendedValue: null,
        confidence: Math.min(0.85, 0.4 + yieldItem.totalDiscovered * 0.005),
        reasoning: `ICP "${yieldItem.icpName}" has a ${(yieldItem.yieldRate * 100).toFixed(1)}% discovery yield rate (${yieldItem.totalLeads} leads from ${yieldItem.totalDiscovered} discovered). Consider switching search categories or adjusting the discovery strategy for this segment.`,
      });
    }
  }

  // 8. High-yield ICPs → increase discovery volume
  for (const yieldItem of discoveryYield.icpYieldRates) {
    if (yieldItem.totalDiscovered >= 10 && yieldItem.yieldRate > 0.15) {
      recommendations.push({
        type: 'INCREASE_VOLUME',
        icpProfileId: yieldItem.icpProfileId,
        field: 'discoveryVolume',
        currentValue: yieldItem.totalDiscovered,
        recommendedValue: null,
        confidence: Math.min(0.8, 0.4 + yieldItem.yieldRate * 2),
        reasoning: `ICP "${yieldItem.icpName}" has a strong ${(yieldItem.yieldRate * 100).toFixed(1)}% discovery yield rate. Consider increasing search budget to capture more high-converting leads in this segment.`,
      });
    }
  }

  // 9. Deal loss analysis — flag ICPs with high deal loss rate
  for (const item of icpDealLoss) {
    if (item.totalDeals >= 3 && item.dealLossRate > 0.4) {
      recommendations.push({
        type: 'PAUSE_ICP',
        icpProfileId: item.icpProfileId,
        field: 'dealLossRate',
        currentValue: item.dealLossRate,
        recommendedValue: null,
        confidence: Math.min(0.85, 0.4 + item.totalDeals * 0.03),
        reasoning: `ICP "${item.icpName}" has a ${(item.dealLossRate * 100).toFixed(1)}% deal loss rate (${item.dealLost} lost out of ${item.totalDeals} total deals). Consider adjusting targeting criteria, pricing approach, or sales messaging for this segment.`,
      });
    }
  }

  return recommendations;
}

// ── Persist recommendations as individual records ───────────

function generateTitle(rec: ManagerRecommendation): string {
  switch (rec.type) {
    case 'PAUSE_ICP':
      return `Pause outreach for underperforming ICP`;
    case 'ADJUST_THRESHOLD':
      return `Adjust scoring threshold`;
    case 'ADJUST_WEIGHT':
      return `Review scoring weight balance`;
    case 'INCREASE_VOLUME':
      return `Increase discovery volume`;
    case 'PREFER_VARIANT':
      return `Prefer winning message variant`;
    case 'DISABLE_FEATURE':
      return `Consider disabling low-signal feature`;
    case 'SWITCH_SOURCE':
      return `Review discovery source for low-yield segment`;
    default:
      return `Pipeline optimization recommendation`;
  }
}

function computePriority(rec: ManagerRecommendation): number {
  // Higher confidence + actionable type = higher priority (1 = highest)
  let base = Math.round((1 - rec.confidence) * 10);
  if (rec.type === 'PAUSE_ICP') base = Math.max(1, base - 2);
  if (rec.type === 'ADJUST_THRESHOLD') base = Math.max(1, base - 1);
  return Math.max(1, Math.min(10, base));
}

async function persistRecommendationRecords(
  analysisId: string,
  recommendations: ManagerRecommendation[],
  icpBreakdown: IcpBreakdownItem[],
  logger: ManagerAnalyzeLogger,
): Promise<void> {
  const icpNameMap = new Map(icpBreakdown.map((icp) => [icp.icpProfileId, icp.icpName]));

  for (const rec of recommendations) {
    try {
      await prisma.managerRecommendationRecord.create({
        data: {
          type: rec.type,
          title: generateTitle(rec),
          description: rec.reasoning,
          icpProfileId: rec.icpProfileId,
          icpName: rec.icpProfileId ? (icpNameMap.get(rec.icpProfileId) ?? null) : null,
          field: rec.field,
          currentValue: rec.currentValue,
          recommendedValue: rec.recommendedValue,
          confidence: rec.confidence,
          priority: computePriority(rec),
          status: 'active',
          analysisRunId: analysisId,
        },
      });
    } catch (err) {
      logger.warn(
        { error: formatErrorMessage(err), type: rec.type, field: rec.field },
        'Failed to persist recommendation record (non-fatal)',
      );
    }
  }
}

// ── Main job handler ────────────────────────────────────────

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
    const now = new Date();
    const weekEnd = now;
    const weekStart = new Date(now.getTime() - ONE_WEEK_MS);
    const prevWeekStart = new Date(weekStart.getTime() - ONE_WEEK_MS);

    // Run all analyses in parallel
    const [
      currentMetrics,
      prevMetrics,
      icpBreakdown,
      variantBreakdown,
      scoreBandBreakdown,
      discoveryYield,
      icpDealLoss,
    ] = await Promise.all([
      computeWeekMetrics(weekStart, weekEnd),
      computeWeekMetrics(prevWeekStart, weekStart),
      computeIcpBreakdown(weekStart, weekEnd),
      computeVariantBreakdown(weekStart, weekEnd),
      computeScoreBandBreakdown(weekStart, weekEnd),
      computeDiscoveryYield(),
      computeIcpDealLoss(weekStart, weekEnd),
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
      discoveryYield,
      icpDealLoss,
    );

    // Persist the full analysis
    const analysis = await prisma.managerAnalysis.create({
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
        icpBreakdownJson: JSON.parse(JSON.stringify(icpBreakdown)),
        variantBreakdownJson: JSON.parse(JSON.stringify(variantBreakdown)),
        scoreBandBreakdownJson: JSON.parse(JSON.stringify(scoreBandBreakdown)),
        trendJson: JSON.parse(JSON.stringify(trend)),
        recommendationsJson: JSON.parse(JSON.stringify(recommendations)),
        recommendationCount: recommendations.length,
      },
    });

    // Persist individual recommendation records
    await persistRecommendationRecords(analysis.id, recommendations, icpBreakdown, logger);

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
        discoveryYieldIcps: discoveryYield.icpYieldRates.length,
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
        error: formatErrorMessage(error),
      },
      'Failed manager.analyze job',
    );

    throw error;
  }
}
