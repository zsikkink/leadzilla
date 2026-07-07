import {
  ENRICHED_LEAD_STATUSES,
  QUALIFIED_LEAD_STATUSES,
  SCORED_LEAD_STATUSES,
  SENT_MESSAGE_STATUSES,
} from '@lead-flood/contracts';
import type {
  AvgScoreQuery,
  AvgScoreResponse,
  DailyQualityTrendItem,
  DailyQualityTrendsQuery,
  DailyQualityTrendsResponse,
  FunnelQuery,
  FunnelResponse,
  IcpPerformanceQuery,
  IcpPerformanceResponse,
  IcpBreakdownItem,
  ManagerAnalysisResponse,
  ManagerRecommendation,
  ManagerRecommendationsQuery,
  ManagerRecommendationsResponse,
  ModelMetricsQuery,
  ModelMetricsResponse,
  RecomputeRollupRequest,
  RetrainStatusQuery,
  RetrainStatusResponse,
  ScoreBandBreakdownItem,
  ScoreDistributionQuery,
  ScoreDistributionResponse,
  StoredRecommendation,
  StoredRecommendationsQuery,
  StoredRecommendationsResponse,
  TrendComparison,
  UpdateRecommendationStatusRequest,
  VariantBreakdownItem,
} from '@lead-flood/contracts';
import { prisma, query as dbQuery } from '@lead-flood/db';

import { AnalyticsNotImplementedError } from './analytics.errors.js';

export interface AnalyticsRepository {
  getFunnel(query: FunnelQuery): Promise<FunnelResponse>;
  getScoreDistribution(query: ScoreDistributionQuery): Promise<ScoreDistributionResponse>;
  getDailyQualityTrends(query: DailyQualityTrendsQuery): Promise<DailyQualityTrendsResponse>;
  getAvgScore(query: AvgScoreQuery): Promise<AvgScoreResponse>;
  getIcpPerformance(query: IcpPerformanceQuery): Promise<IcpPerformanceResponse>;
  getModelMetrics(query: ModelMetricsQuery): Promise<ModelMetricsResponse>;
  getRetrainStatus(query: RetrainStatusQuery): Promise<RetrainStatusResponse>;
  recomputeRollup(input: RecomputeRollupRequest): Promise<void>;
  getManagerRecommendations(query: ManagerRecommendationsQuery): Promise<ManagerRecommendationsResponse>;
  getStoredRecommendations(query: StoredRecommendationsQuery): Promise<StoredRecommendationsResponse>;
  updateRecommendationStatus(id: string, input: UpdateRecommendationStatusRequest): Promise<StoredRecommendation>;
}

export class StubAnalyticsRepository implements AnalyticsRepository {
  async getFunnel(_query: FunnelQuery): Promise<FunnelResponse> {
    throw new AnalyticsNotImplementedError('TODO: get funnel analytics persistence');
  }

  async getScoreDistribution(_query: ScoreDistributionQuery): Promise<ScoreDistributionResponse> {
    throw new AnalyticsNotImplementedError('TODO: get score distribution persistence');
  }

  async getDailyQualityTrends(_query: DailyQualityTrendsQuery): Promise<DailyQualityTrendsResponse> {
    throw new AnalyticsNotImplementedError('TODO: get daily quality trends persistence');
  }

  async getAvgScore(_query: AvgScoreQuery): Promise<AvgScoreResponse> {
    throw new AnalyticsNotImplementedError('TODO: get avg score persistence');
  }

  async getIcpPerformance(_query: IcpPerformanceQuery): Promise<IcpPerformanceResponse> {
    throw new AnalyticsNotImplementedError('TODO: get ICP performance persistence');
  }

  async getModelMetrics(_query: ModelMetricsQuery): Promise<ModelMetricsResponse> {
    throw new AnalyticsNotImplementedError('TODO: get model metrics persistence');
  }

  async getRetrainStatus(_query: RetrainStatusQuery): Promise<RetrainStatusResponse> {
    throw new AnalyticsNotImplementedError('TODO: get retrain status persistence');
  }

  async recomputeRollup(_input: RecomputeRollupRequest): Promise<void> {
    throw new AnalyticsNotImplementedError('TODO: recompute rollup trigger persistence');
  }

  async getManagerRecommendations(_query: ManagerRecommendationsQuery): Promise<ManagerRecommendationsResponse> {
    throw new AnalyticsNotImplementedError('TODO: manager recommendations persistence');
  }

  async getStoredRecommendations(_query: StoredRecommendationsQuery): Promise<StoredRecommendationsResponse> {
    throw new AnalyticsNotImplementedError('TODO: stored recommendations persistence');
  }

  async updateRecommendationStatus(_id: string, _input: UpdateRecommendationStatusRequest): Promise<StoredRecommendation> {
    throw new AnalyticsNotImplementedError('TODO: update recommendation status persistence');
  }
}

export class PrismaAnalyticsRepository extends StubAnalyticsRepository {
  override async getFunnel(query: FunnelQuery): Promise<FunnelResponse> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const icpProfileId = query.icpProfileId ?? null;

    const leadWhere = {
      deletedAt: null,
      ...(icpProfileId
        ? {
            discoveryRecords: {
              some: { icpProfileId },
            },
          }
        : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const draftDateWhere = from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const sendDateWhere = from || to
      ? {
          sentAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const feedbackDateWhere = from || to
      ? {
          occurredAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const [
      discoveredCount,
      qualifiedCount,
      enrichedCount,
      scoredCount,
      costAgg,
      messagesGeneratedCount,
      messagesSentCount,
      repliesCount,
      meetingsCount,
      dealsWonCount,
    ] = await Promise.all([
      prisma.lead.count({
        where: leadWhere,
      }),
      prisma.lead.count({
        where: {
          ...leadWhere,
          status: { in: [...QUALIFIED_LEAD_STATUSES] },
        },
      }),
      prisma.lead.count({
        where: {
          ...leadWhere,
          status: { in: [...ENRICHED_LEAD_STATUSES] },
        },
      }),
      prisma.lead.count({
        where: {
          ...leadWhere,
          status: { in: [...SCORED_LEAD_STATUSES] },
        },
      }),
      prisma.lead.aggregate({
        where: leadWhere,
        _sum: { costCents: true },
        _count: { id: true },
      }),
      prisma.messageDraft.count({
        where: {
          ...(icpProfileId ? { icpProfileId } : {}),
          ...draftDateWhere,
        },
      }),
      prisma.messageSend.count({
        where: {
          ...sendDateWhere,
          status: { in: [...SENT_MESSAGE_STATUSES] },
          ...(icpProfileId
            ? {
                messageDraft: { icpProfileId },
              }
            : {}),
        },
      }),
      prisma.feedbackEvent.count({
        where: {
          ...feedbackDateWhere,
          eventType: 'REPLIED',
          ...(icpProfileId
            ? {
                lead: {
                  discoveryRecords: {
                    some: { icpProfileId },
                  },
                },
              }
            : {}),
        },
      }),
      prisma.feedbackEvent.count({
        where: {
          ...feedbackDateWhere,
          eventType: 'MEETING_BOOKED',
          ...(icpProfileId
            ? {
                lead: {
                  discoveryRecords: {
                    some: { icpProfileId },
                  },
                },
              }
            : {}),
        },
      }),
      prisma.feedbackEvent.count({
        where: {
          ...feedbackDateWhere,
          eventType: 'DEAL_WON',
          ...(icpProfileId
            ? {
                lead: {
                  discoveryRecords: {
                    some: { icpProfileId },
                  },
                },
              }
            : {}),
        },
      }),
    ]);

    const totalCostCents = costAgg._sum.costCents ?? 0;
    const costPerLead = discoveredCount > 0
      ? Math.round((totalCostCents / discoveredCount) * 100) / 100
      : 0;

    return {
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      icpProfileId,
      discoveredCount,
      qualifiedCount,
      enrichedCount,
      scoredCount,
      messagesGeneratedCount,
      messagesSentCount,
      repliesCount,
      meetingsCount,
      dealsWonCount,
      totalCostCents,
      costPerLead,
    };
  }

  override async getScoreDistribution(query: ScoreDistributionQuery): Promise<ScoreDistributionResponse> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const where = {
      ...(query.icpProfileId ? { icpProfileId: query.icpProfileId } : {}),
      ...(query.modelVersionId ? { modelVersionId: query.modelVersionId } : {}),
      ...(from || to
        ? {
            predictedAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };

    const groups = await prisma.leadScorePrediction.groupBy({
      by: ['scoreBand'],
      where,
      _count: { id: true },
    });

    const bandOrder: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['LOW', 'MEDIUM', 'HIGH'];

    const bands = bandOrder.map((band) => {
      const match = groups.find((group) => group.scoreBand === band);
      return { scoreBand: band, count: match?._count.id ?? 0 };
    });

    return { bands };
  }

  override async getModelMetrics(query: ModelMetricsQuery): Promise<ModelMetricsResponse> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const evaluations = await prisma.modelEvaluation.findMany({
      where: {
        ...(query.modelVersionId ? { modelVersionId: query.modelVersionId } : {}),
        ...(from || to
          ? {
              evaluatedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: {
        modelVersion: {
          select: { versionTag: true },
        },
      },
      orderBy: [{ evaluatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      items: evaluations.map((evaluation) => ({
        modelVersionId: evaluation.modelVersionId,
        versionTag: evaluation.modelVersion.versionTag,
        split: evaluation.split,
        evaluatedAt: evaluation.evaluatedAt.toISOString(),
        auc: evaluation.auc,
        prAuc: evaluation.prAuc,
        precision: evaluation.precision,
        recall: evaluation.recall,
        f1: evaluation.f1,
        brierScore: evaluation.brierScore,
      })),
    };
  }

  override async getRetrainStatus(query: RetrainStatusQuery): Promise<RetrainStatusResponse> {
    const modelTypeWhere = query.modelType ? { modelType: query.modelType } : {};

    const [activeModelVersion, currentRun, lastSuccessfulRun] = await Promise.all([
      prisma.modelVersion.findFirst({
        where: { ...modelTypeWhere, stage: 'ACTIVE' },
        select: { id: true },
        orderBy: [
          { activatedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
      }),
      prisma.trainingRun.findFirst({
        where: {
          ...modelTypeWhere,
          status: { in: ['RUNNING', 'QUEUED'] },
        },
        select: {
          id: true,
          status: true,
          startedAt: true,
          endedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      prisma.trainingRun.findFirst({
        where: {
          ...modelTypeWhere,
          status: 'SUCCEEDED',
        },
        select: {
          id: true,
          endedAt: true,
        },
        orderBy: [{ endedAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      activeModelVersionId: activeModelVersion?.id ?? null,
      currentRun: currentRun
        ? {
            trainingRunId: currentRun.id,
            status: currentRun.status,
            startedAt: currentRun.startedAt?.toISOString() ?? null,
            endedAt: currentRun.endedAt?.toISOString() ?? null,
          }
        : null,
      lastSuccessfulRun:
        lastSuccessfulRun && lastSuccessfulRun.endedAt
          ? {
              trainingRunId: lastSuccessfulRun.id,
              endedAt: lastSuccessfulRun.endedAt.toISOString(),
            }
          : null,
      nextScheduledAt: null,
    };
  }

  override async recomputeRollup(input: RecomputeRollupRequest): Promise<void> {
    const dayStart = new Date(`${input.day}T00:00:00.000Z`);
    const dayEnd = new Date(`${input.day}T23:59:59.999Z`);

    const icpProfilesToProcess = input.icpProfileId
      ? [input.icpProfileId]
      : await prisma.icpProfile
          .findMany({
            where: { isActive: true },
            select: { id: true },
          })
          .then((profiles) => profiles.map((profile) => profile.id));

    for (const icpProfileId of icpProfilesToProcess) {
      const [discoveredCount, enrichedCount, scoredCount] = await Promise.all([
        prisma.leadDiscoveryRecord.count({
          where: {
            icpProfileId,
            discoveredAt: { gte: dayStart, lte: dayEnd },
            status: 'DISCOVERED',
          },
        }),
        prisma.leadEnrichmentRecord.count({
          where: {
            status: 'COMPLETED',
            enrichedAt: { gte: dayStart, lte: dayEnd },
            lead: {
              discoveryRecords: {
                some: { icpProfileId },
              },
            },
          },
        }),
        prisma.leadScorePrediction.count({
          where: {
            icpProfileId,
            predictedAt: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);

      await prisma.analyticsDailyRollup.upsert({
        where: { day_icpProfileId: { day: dayStart, icpProfileId } },
        create: {
          day: dayStart,
          icpProfileId,
          discoveredCount,
          enrichedCount,
          scoredCount,
        },
        update: {
          discoveredCount,
          enrichedCount,
          scoredCount,
        },
      });
    }
  }

  override async getManagerRecommendations(query: ManagerRecommendationsQuery): Promise<ManagerRecommendationsResponse> {
    const limit = query.limit ?? 10;

    const analyses = await prisma.managerAnalysis.findMany({
      orderBy: [{ createdAt: 'desc' }],
      take: limit,
    });

    const items: ManagerAnalysisResponse[] = analyses.map((analysis) => ({
      id: analysis.id,
      runId: analysis.runId,
      weekStart: analysis.weekStart.toISOString(),
      weekEnd: analysis.weekEnd.toISOString(),
      totalSends: analysis.totalSends,
      totalReplies: analysis.totalReplies,
      totalPositive: analysis.totalPositive,
      totalBounced: analysis.totalBounced,
      overallReplyRate: analysis.overallReplyRate,
      overallPositiveRate: analysis.overallPositiveRate,
      overallBounceRate: analysis.overallBounceRate,
      icpBreakdown: (analysis.icpBreakdownJson as unknown as IcpBreakdownItem[]) ?? [],
      variantBreakdown: (analysis.variantBreakdownJson as unknown as VariantBreakdownItem[]) ?? [],
      scoreBandBreakdown: (analysis.scoreBandBreakdownJson as unknown as ScoreBandBreakdownItem[]) ?? [],
      trend: analysis.trendJson as unknown as TrendComparison,
      recommendations: (analysis.recommendationsJson as unknown as ManagerRecommendation[]) ?? [],
      createdAt: analysis.createdAt.toISOString(),
    }));

    return { items };
  }

  override async getStoredRecommendations(query: StoredRecommendationsQuery): Promise<StoredRecommendationsResponse> {
    const limit = query.limit ?? 50;

    const where: Record<string, unknown> = {};
    if (query.status) {
      where['status'] = query.status;
    }
    if (query.icpProfileId) {
      where['icpProfileId'] = query.icpProfileId;
    }

    const records = await prisma.managerRecommendationRecord.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });

    const items: StoredRecommendation[] = records.map((rec) => ({
      id: rec.id,
      type: rec.type as StoredRecommendation['type'],
      title: rec.title,
      description: rec.description,
      icpProfileId: rec.icpProfileId,
      icpName: rec.icpName,
      field: rec.field,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      confidence: rec.confidence,
      priority: rec.priority,
      status: rec.status as StoredRecommendation['status'],
      analysisRunId: rec.analysisRunId,
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
    }));

    return { items };
  }

  override async updateRecommendationStatus(id: string, input: UpdateRecommendationStatusRequest): Promise<StoredRecommendation> {
    const rec = await prisma.managerRecommendationRecord.update({
      where: { id },
      data: { status: input.status },
    });

    return {
      id: rec.id,
      type: rec.type as StoredRecommendation['type'],
      title: rec.title,
      description: rec.description,
      icpProfileId: rec.icpProfileId,
      icpName: rec.icpName,
      field: rec.field,
      currentValue: rec.currentValue,
      recommendedValue: rec.recommendedValue,
      confidence: rec.confidence,
      priority: rec.priority,
      status: rec.status as StoredRecommendation['status'],
      analysisRunId: rec.analysisRunId,
      createdAt: rec.createdAt.toISOString(),
      updatedAt: rec.updatedAt.toISOString(),
    };
  }
}

const SCORE_BAND_ORDER = ['LOW', 'MEDIUM', 'HIGH'] as const;

type ScoreDistributionBand = (typeof SCORE_BAND_ORDER)[number];

interface ScoreDistributionRow {
  scoreBand: ScoreDistributionBand;
  count: number | string;
}

interface StoredRecommendationSqlRow {
  id: string;
  type: string;
  title: string;
  description: string;
  icpProfileId: string | null;
  icpName: string | null;
  field: string | null;
  currentValue: number | null;
  recommendedValue: number | null;
  confidence: number;
  priority: number;
  status: string;
  analysisRunId: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

type RetrainRunStatus = NonNullable<RetrainStatusResponse['currentRun']>['status'];

interface RetrainStatusActiveModelRow {
  id: string;
}

interface RetrainStatusCurrentRunRow {
  id: string;
  status: RetrainRunStatus;
  startedAtMs: number | null;
  endedAtMs: number | null;
}

interface RetrainStatusLastSuccessfulRunRow {
  id: string;
  endedAtMs: number | null;
}

interface DailyQualityLeadAggregateRow {
  day: string;
  totalCreated: number | string;
  rejectedCount: number | string;
}

interface DailyQualityScoreAggregateRow {
  day: string;
  avgScore: number | string;
}

interface AvgScoreAggregateRow {
  avgScore: number | string | null;
}

interface IcpPerformanceAggregateRow {
  icpProfileId: string;
  leadCount: number | string;
  avgScore: number | string | null;
  qualifiedCount: number | string;
  rejectedCount: number | string;
}

function toNonNegativeInt(value: number | string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export class HybridAnalyticsRepository extends PrismaAnalyticsRepository {
  override async getScoreDistribution(input: ScoreDistributionQuery): Promise<ScoreDistributionResponse> {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const values: unknown[] = [];
    const filters: string[] = [];

    if (input.icpProfileId) {
      values.push(input.icpProfileId);
      filters.push(`"icpProfileId" = $${values.length}`);
    }

    if (input.modelVersionId) {
      values.push(input.modelVersionId);
      filters.push(`"modelVersionId" = $${values.length}`);
    }

    if (from) {
      values.push(from);
      filters.push(`"predictedAt" >= $${values.length}`);
    }

    if (to) {
      values.push(to);
      filters.push(`"predictedAt" <= $${values.length}`);
    }

    const whereClause = filters.length > 0 ? `where ${filters.join(' and ')}` : '';
    const result = await dbQuery<ScoreDistributionRow>(
      `
        select
          "scoreBand" as "scoreBand",
          count(*)::integer as count
        from public."LeadScorePrediction"
        ${whereClause}
        group by "scoreBand"
      `,
      values,
    );

    const bands = SCORE_BAND_ORDER.map((scoreBand) => {
      const match = result.rows.find((row) => row.scoreBand === scoreBand);
      return {
        scoreBand,
        count: toNonNegativeInt(match?.count ?? 0),
      };
    });

    return { bands };
  }

  override async getDailyQualityTrends(input: DailyQualityTrendsQuery): Promise<DailyQualityTrendsResponse> {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;

    const [leadRowsResult, scoreRowsResult] = await Promise.all([
      dbQuery<DailyQualityLeadAggregateRow>(
        `
          select
            to_char("createdAt"::date, 'YYYY-MM-DD') as day,
            count(*)::integer as "totalCreated",
            count(*) filter (where status = 'rejected')::integer as "rejectedCount"
          from public."Lead"
          where "deletedAt" is null
            and ($1::timestamp is null or "createdAt" >= $1)
            and ($2::timestamp is null or "createdAt" <= $2)
          group by 1
          order by 1 asc
        `,
        [from, to],
      ),
      dbQuery<DailyQualityScoreAggregateRow>(
        `
          select
            to_char(sp."predictedAt"::date, 'YYYY-MM-DD') as day,
            avg(sp."blendedScore")::double precision as "avgScore"
          from public."LeadScorePrediction" sp
          join public."Lead" lead
            on lead."id" = sp."leadId"
          where lead."deletedAt" is null
            and ($1::timestamp is null or sp."predictedAt" >= $1)
            and ($2::timestamp is null or sp."predictedAt" <= $2)
          group by 1
          order by 1 asc
        `,
        [from, to],
      ),
    ]);

    const dayMap = new Map<string, DailyQualityTrendItem>();

    for (const row of leadRowsResult.rows) {
      dayMap.set(row.day, {
        day: row.day,
        avgScore: 0,
        totalCreated: toNonNegativeInt(row.totalCreated),
        rejectedCount: toNonNegativeInt(row.rejectedCount),
      });
    }

    for (const row of scoreRowsResult.rows) {
      const existing = dayMap.get(row.day);
      const avgScore = Number(row.avgScore);
      dayMap.set(row.day, {
        day: row.day,
        avgScore: Number.isFinite(avgScore) ? avgScore : 0,
        totalCreated: existing?.totalCreated ?? 0,
        rejectedCount: existing?.rejectedCount ?? 0,
      });
    }

    return {
      items: Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }

  override async getAvgScore(_input: AvgScoreQuery): Promise<AvgScoreResponse> {
    const result = await dbQuery<AvgScoreAggregateRow>(
      `
        select
          avg("blendedScore")::double precision as "avgScore"
        from public."LeadScorePrediction"
      `,
      [],
    );

    const rawAvgScore = result.rows[0]?.avgScore;
    const avgScore = rawAvgScore === null || rawAvgScore === undefined ? null : Number(rawAvgScore);

    return {
      avgScore: avgScore !== null && Number.isFinite(avgScore) ? avgScore : null,
    };
  }

  override async getIcpPerformance(_input: IcpPerformanceQuery): Promise<IcpPerformanceResponse> {
    const result = await dbQuery<IcpPerformanceAggregateRow>(
      `
        with scored as (
          select
            sp."icpProfileId" as "icpProfileId",
            count(distinct sp."leadId")::integer as "leadCount",
            avg(sp."blendedScore")::double precision as "avgScore"
          from public."LeadScorePrediction" sp
          group by sp."icpProfileId"
        ),
        qualified as (
          select
            sp."icpProfileId" as "icpProfileId",
            count(distinct sp."leadId")::integer as "qualifiedCount"
          from public."LeadScorePrediction" sp
          join public."Lead" lead
            on lead."id" = sp."leadId"
          where lead."deletedAt" is null
            and lead."status" in ('qualified', 'drafted', 'messaged', 'replied', 'cold')
          group by sp."icpProfileId"
        ),
        rejections as (
          select
            lr."icpProfileId" as "icpProfileId",
            count(*)::integer as "rejectedCount"
          from public."lead_rejections" lr
          where lr."icpProfileId" is not null
          group by lr."icpProfileId"
        )
        select
          scored."icpProfileId" as "icpProfileId",
          scored."leadCount" as "leadCount",
          scored."avgScore" as "avgScore",
          coalesce(qualified."qualifiedCount", 0)::integer as "qualifiedCount",
          coalesce(rejections."rejectedCount", 0)::integer as "rejectedCount"
        from scored
        left join qualified
          on qualified."icpProfileId" = scored."icpProfileId"
        left join rejections
          on rejections."icpProfileId" = scored."icpProfileId"
        order by scored."leadCount" desc, scored."icpProfileId" asc
      `,
      [],
    );

    return {
      items: result.rows.map((row) => {
        const avgScore = row.avgScore === null ? null : Number(row.avgScore);
        return {
          icpProfileId: row.icpProfileId,
          leadCount: toNonNegativeInt(row.leadCount),
          avgScore: avgScore !== null && Number.isFinite(avgScore) ? avgScore : null,
          qualifiedCount: toNonNegativeInt(row.qualifiedCount),
          rejectedCount: toNonNegativeInt(row.rejectedCount),
        };
      }),
    };
  }

  override async getRetrainStatus(input: RetrainStatusQuery): Promise<RetrainStatusResponse> {
    const modelTypeValues = input.modelType ? [input.modelType] : [];
    const modelTypeFilter = input.modelType ? `and "modelType" = $1` : '';

    const [activeModelVersionResult, currentRunResult, lastSuccessfulRunResult] = await Promise.all([
      dbQuery<RetrainStatusActiveModelRow>(
        `
          select "id"
          from public."ModelVersion"
          where "stage" = 'ACTIVE'
            ${modelTypeFilter}
          order by "activatedAt" desc nulls last, "createdAt" desc
          limit 1
        `,
        modelTypeValues,
      ),
      dbQuery<RetrainStatusCurrentRunRow>(
        `
          select
            "id",
            "status",
            (extract(epoch from "startedAt") * 1000)::double precision as "startedAtMs",
            (extract(epoch from "endedAt") * 1000)::double precision as "endedAtMs"
          from public."TrainingRun"
          where "status" in ('RUNNING', 'QUEUED')
            ${modelTypeFilter}
          order by "createdAt" desc
          limit 1
        `,
        modelTypeValues,
      ),
      dbQuery<RetrainStatusLastSuccessfulRunRow>(
        `
          select
            "id",
            (extract(epoch from "endedAt") * 1000)::double precision as "endedAtMs"
          from public."TrainingRun"
          where "status" = 'SUCCEEDED'
            ${modelTypeFilter}
          order by "endedAt" desc, "createdAt" desc
          limit 1
        `,
        modelTypeValues,
      ),
    ]);

    const activeModelVersion = activeModelVersionResult.rows[0];
    const currentRun = currentRunResult.rows[0];
    const lastSuccessfulRun = lastSuccessfulRunResult.rows[0];

    return {
      activeModelVersionId: activeModelVersion?.id ?? null,
      currentRun: currentRun
        ? {
            trainingRunId: currentRun.id,
            status: currentRun.status,
            startedAt: currentRun.startedAtMs !== null ? new Date(currentRun.startedAtMs).toISOString() : null,
            endedAt: currentRun.endedAtMs !== null ? new Date(currentRun.endedAtMs).toISOString() : null,
          }
        : null,
      lastSuccessfulRun:
        lastSuccessfulRun && lastSuccessfulRun.endedAtMs !== null
          ? {
              trainingRunId: lastSuccessfulRun.id,
              endedAt: new Date(lastSuccessfulRun.endedAtMs).toISOString(),
            }
          : null,
      nextScheduledAt: null,
    };
  }

  override async getStoredRecommendations(input: StoredRecommendationsQuery): Promise<StoredRecommendationsResponse> {
    const limit = input.limit ?? 50;
    const values: unknown[] = [];
    const filters: string[] = [];

    if (input.status) {
      values.push(input.status);
      filters.push(`"status" = $${values.length}`);
    }

    if (input.icpProfileId) {
      values.push(input.icpProfileId);
      filters.push(`"icpProfileId" = $${values.length}`);
    }

    values.push(limit);
    const limitPlaceholder = `$${values.length}`;
    const whereClause = filters.length > 0 ? `where ${filters.join(' and ')}` : '';

    const result = await dbQuery<StoredRecommendationSqlRow>(
      `
        select
          "id",
          "type",
          "title",
          "description",
          "icpProfileId",
          "icpName",
          "field",
          "currentValue",
          "recommendedValue",
          "confidence",
          "priority",
          "status",
          "analysisRunId",
          (extract(epoch from "createdAt") * 1000)::double precision as "createdAtMs",
          (extract(epoch from "updatedAt") * 1000)::double precision as "updatedAtMs"
        from public."manager_recommendation_records"
        ${whereClause}
        order by "priority" asc, "createdAt" desc
        limit ${limitPlaceholder}
      `,
      values,
    );

    return {
      items: result.rows.map((row) => ({
        id: row.id,
        type: row.type as StoredRecommendation['type'],
        title: row.title,
        description: row.description,
        icpProfileId: row.icpProfileId,
        icpName: row.icpName,
        field: row.field,
        currentValue: row.currentValue,
        recommendedValue: row.recommendedValue,
        confidence: row.confidence,
        priority: row.priority,
        status: row.status as StoredRecommendation['status'],
        analysisRunId: row.analysisRunId,
        createdAt: new Date(row.createdAtMs).toISOString(),
        updatedAt: new Date(row.updatedAtMs).toISOString(),
      })),
    };
  }
}
