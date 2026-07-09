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
  DashboardSummaryQuery,
  DashboardSummaryResponse,
  DiscoveryRunSummary,
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
  getDashboardSummary(query: DashboardSummaryQuery): Promise<DashboardSummaryResponse>;
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

  async getDashboardSummary(_query: DashboardSummaryQuery): Promise<DashboardSummaryResponse> {
    throw new AnalyticsNotImplementedError('TODO: get dashboard summary persistence');
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
      businessCount,
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
      prisma.business.count(),
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
      businessCount,
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

    const scoreRows = await prisma.leadScorePrediction.findMany({
      where,
      orderBy: [{ leadId: 'asc' }, { predictedAt: 'desc' }, { createdAt: 'desc' }],
      distinct: ['leadId'],
      select: { blendedScore: true, scoreBand: true },
    });

    const bandOrder: Array<'LOW' | 'MEDIUM' | 'HIGH'> = ['LOW', 'MEDIUM', 'HIGH'];

    const bands = bandOrder.map((band) => {
      return {
        scoreBand: band,
        count: scoreRows.filter((row) => row.scoreBand === band).length,
      };
    });

    return {
      bands,
      histogram: buildScoreHistogramFromScores(scoreRows.map((row) => row.blendedScore)),
    };
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
      const discoveryRows = await prisma.leadDiscoveryRecord.findMany({
        where: {
          icpProfileId,
          discoveredAt: { gte: dayStart, lte: dayEnd },
          status: 'DISCOVERED',
        },
        select: {
          leadId: true,
          lead: {
            select: {
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

      const [enrichedCount, scoreRows, messagesGeneratedCount, sentCount, failedCount] = await Promise.all([
        uniqueLeadIds.length === 0
          ? Promise.resolve(0)
          : prisma.leadEnrichmentRecord.count({
              where: {
                status: 'COMPLETED',
                enrichedAt: { gte: dayStart, lte: dayEnd },
                leadId: { in: uniqueLeadIds },
              },
            }),
        prisma.leadScorePrediction.findMany({
          where: {
            icpProfileId,
            predictedAt: { gte: dayStart, lte: dayEnd },
          },
          orderBy: [{ leadId: 'asc' }, { predictedAt: 'desc' }, { createdAt: 'desc' }],
          distinct: ['leadId'],
          select: { blendedScore: true, scoreBand: true },
        }),
        prisma.messageDraft.count({
          where: {
            icpProfileId,
            createdAt: { gte: dayStart, lte: dayEnd },
          },
        }),
        prisma.messageSend.count({
          where: {
            messageDraft: { icpProfileId },
            status: { in: [...SENT_MESSAGE_STATUSES] },
            sentAt: { gte: dayStart, lte: dayEnd },
          },
        }),
        prisma.messageSend.count({
          where: {
            messageDraft: { icpProfileId },
            status: 'FAILED',
            createdAt: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);
      const scoredCount = scoreRows.length;
      const scoreSum = scoreRows.reduce((sum, row) => sum + row.blendedScore, 0);
      const lowScoreCount = scoreRows.filter((row) => row.scoreBand === 'LOW').length;
      const mediumScoreCount = scoreRows.filter((row) => row.scoreBand === 'MEDIUM').length;
      const highScoreCount = scoreRows.filter((row) => row.scoreBand === 'HIGH').length;
      const scoreBucketCounts = Array.from({ length: 10 }, () => 0);
      for (const row of scoreRows) {
        scoreBucketCounts[scoreBucketIndex(row.blendedScore)]! += 1;
      }

      const feedbackWhereBase = {
        occurredAt: { gte: dayStart, lte: dayEnd },
        lead: {
          discoveryRecords: {
            some: { icpProfileId },
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
        prisma.feedbackEvent.count({ where: { ...feedbackWhereBase, eventType: 'REPLIED' } }),
        prisma.feedbackEvent.count({ where: { ...feedbackWhereBase, eventType: 'MEETING_BOOKED' } }),
        prisma.feedbackEvent.count({ where: { ...feedbackWhereBase, eventType: 'DEAL_WON' } }),
        prisma.feedbackEvent.count({ where: { ...feedbackWhereBase, eventType: 'DEAL_LOST' } }),
        prisma.feedbackEvent.count({ where: { ...feedbackWhereBase, eventType: 'BOUNCED' } }),
        prisma.feedbackEvent.count({
          where: { ...feedbackWhereBase, eventType: { in: ['NOT_INTERESTED', 'UNSUBSCRIBED'] } },
        }),
        prisma.leadRejection.count({
          where: {
            icpProfileId,
            rejectedAt: { gte: dayStart, lte: dayEnd },
          },
        }),
      ]);

      const rollupData = {
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
      };

      await prisma.analyticsDailyRollup.upsert({
        where: { day_icpProfileId: { day: dayStart, icpProfileId } },
        create: {
          day: dayStart,
          icpProfileId,
          ...rollupData,
        },
        update: rollupData,
      });
    }
  }

  override async getDashboardSummary(query: DashboardSummaryQuery): Promise<DashboardSummaryResponse> {
    const from = query.from ?? null;
    const to = query.to ?? null;
    const icpProfileId = query.icpProfileId ?? null;

    const rollupWhere = {
      ...(icpProfileId ? { icpProfileId } : {}),
      ...(query.from || query.to
        ? {
            day: {
              ...(query.from ? { gte: toDayStart(query.from) } : {}),
              ...(query.to ? { lte: toDayStart(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rollupRows, businessCount, pendingDraftsCount, discoveryRunsResult] = await Promise.all([
      prisma.analyticsDailyRollup.findMany({
        where: rollupWhere,
        orderBy: [{ day: 'asc' }, { icpProfileId: 'asc' }],
      }),
      prisma.business.count(),
      prisma.messageDraft.count({
        where: {
          approvalStatus: 'PENDING',
          ...(icpProfileId ? { icpProfileId } : {}),
        },
      }),
      this.getRecentDiscoveryRuns(),
    ]);
    const totals = summarizeDashboardRollups(rollupRows);
    const latestRollup = rollupRows.reduce<Date | null>(
      (latest, row) => (latest === null || row.day > latest ? row.day : latest),
      null,
    );

    return {
      from,
      to,
      icpProfileId,
      generatedAt: new Date().toISOString(),
      dataFreshness: {
        qualityRollupBacked: rollupRows.length > 0,
        qualityRollupLatestDay: latestRollup?.toISOString().slice(0, 10) ?? null,
      },
      funnel: {
        from,
        to,
        icpProfileId,
        businessCount,
        discoveredCount: totals.discoveredCount,
        qualifiedCount: totals.qualifiedCount,
        enrichedCount: totals.enrichedCount,
        scoredCount: totals.scoredCount,
        messagesGeneratedCount: totals.messagesGeneratedCount,
        messagesSentCount: totals.sentCount,
        repliesCount: totals.repliedCount,
        meetingsCount: totals.meetingsCount,
        dealsWonCount: totals.dealsWonCount,
        totalCostCents: totals.totalCostCents,
        costPerLead: totals.discoveredCount > 0
          ? Math.round((totals.totalCostCents / totals.discoveredCount) * 100) / 100
          : 0,
      },
      scoreDistribution: {
        bands: [
          { scoreBand: 'LOW', count: totals.lowScoreCount },
          { scoreBand: 'MEDIUM', count: totals.mediumScoreCount },
          { scoreBand: 'HIGH', count: totals.highScoreCount },
        ],
        histogram: buildRollupScoreHistogram(totals.scoreBucketCounts),
      },
      feedback: {
        from,
        to,
        totalEvents:
          totals.repliedCount +
          totals.meetingsCount +
          totals.dealsWonCount +
          totals.dealLostCount +
          totals.bouncedCount +
          totals.notInterestedCount,
        repliedCount: totals.repliedCount,
        meetingBookedCount: totals.meetingsCount,
        dealWonCount: totals.dealsWonCount,
        dealLostCount: totals.dealLostCount,
        bouncedCount: totals.bouncedCount,
        notInterestedCount: totals.notInterestedCount,
      },
      qualityTrends: {
        items: buildRollupQualityTrends(rollupRows),
      },
      avgScore: {
        avgScore: totals.scoredCount > 0 ? totals.scoreSum / totals.scoredCount : null,
      },
      icpPerformance: {
        items: buildRollupIcpPerformance(rollupRows),
      },
      pendingDraftsCount,
      discoveryRuns: discoveryRunsResult.runs,
      discoveryRunsTotal: discoveryRunsResult.total,
    };
  }

  private async getRecentDiscoveryRuns(): Promise<{ runs: DiscoveryRunSummary[]; total: number }> {
    const where = { type: 'discovery.run' };
    const [total, rows] = await Promise.all([
      prisma.jobExecution.count({ where }),
      prisma.jobExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    return {
      runs: rows.map((row) => {
        const progress = readDashboardRunProgress(row.result);
        const payload = asRecord(row.payload);
        const result = asRecord(row.result);
        const icpProfileId = typeof payload.icpProfileId === 'string' ? payload.icpProfileId : null;
        const icpProfileIds = Array.isArray(payload.icpProfileIds)
          ? payload.icpProfileIds.filter((id): id is string => typeof id === 'string')
          : icpProfileId
            ? [icpProfileId]
            : [];
        const countries = Array.isArray(payload.countries)
          ? payload.countries.filter((country): country is string => typeof country === 'string')
          : [];
        const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? payload.limit : 0;
        const converted = typeof result.converted === 'number' && Number.isFinite(result.converted)
          ? result.converted
          : undefined;

        return {
          runId: row.id,
          status: mapDashboardRunStatus(row.status, progress.failedItems),
          totalItems: progress.totalItems,
          processedItems: progress.processedItems,
          failedItems: progress.failedItems,
          createdAt: row.createdAt.toISOString(),
          startedAt: row.startedAt?.toISOString() ?? null,
          finishedAt: row.finishedAt?.toISOString() ?? null,
          icpProfileId,
          icpProfileIds,
          countries,
          limit,
          ...(converted !== undefined ? { converted } : {}),
          errorMessage: row.error,
          currentStage: deriveDashboardRunStage(result, row.status),
        };
      }),
      total,
    };
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

interface ScoreHistogramRow {
  bucketIndex: number | string;
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
type DashboardRunStatus = DiscoveryRunSummary['status'];
type DashboardJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface DashboardRunProgress {
  totalItems: number;
  processedItems: number;
  failedItems: number;
}

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

interface DashboardRollupRow {
  day: Date;
  icpProfileId: string;
  discoveredCount: number;
  qualifiedCount: number;
  enrichedCount: number;
  scoredCount: number;
  scoreSum: number;
  lowScoreCount: number;
  mediumScoreCount: number;
  highScoreCount: number;
  scoreBucket0Count: number;
  scoreBucket1Count: number;
  scoreBucket2Count: number;
  scoreBucket3Count: number;
  scoreBucket4Count: number;
  scoreBucket5Count: number;
  scoreBucket6Count: number;
  scoreBucket7Count: number;
  scoreBucket8Count: number;
  scoreBucket9Count: number;
  messagesGeneratedCount: number;
  sentCount: number;
  failedCount: number;
  repliedCount: number;
  meetingsCount: number;
  dealsWonCount: number;
  dealLostCount: number;
  bouncedCount: number;
  notInterestedCount: number;
  rejectedCount: number;
  totalCostCents: number;
}

interface DashboardRollupTotals {
  discoveredCount: number;
  qualifiedCount: number;
  enrichedCount: number;
  scoredCount: number;
  scoreSum: number;
  lowScoreCount: number;
  mediumScoreCount: number;
  highScoreCount: number;
  scoreBucketCounts: number[];
  messagesGeneratedCount: number;
  sentCount: number;
  failedCount: number;
  repliedCount: number;
  meetingsCount: number;
  dealsWonCount: number;
  dealLostCount: number;
  bouncedCount: number;
  notInterestedCount: number;
  rejectedCount: number;
  totalCostCents: number;
}

function toDayStart(value: string): Date {
  const source = new Date(value);
  return new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
}

function toNonNegativeInt(value: number | string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toNonNegativeCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  return 0;
}

function scoreBucketIndex(score: number): number {
  return Math.min(Math.max(Math.floor(score * 10), 0), 9);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readDashboardRunProgress(result: unknown): DashboardRunProgress {
  const payload = asRecord(result);
  const newFound = toNonNegativeCount(payload.newFound);
  const newBusinesses = toNonNegativeCount(payload.newBusinesses);
  const totalItems =
    newFound > 0
      ? newFound
      : newBusinesses > 0
        ? newBusinesses
        : toNonNegativeCount(payload.totalItems);
  const explicitLeadFailures = toNonNegativeCount(payload.leadFailedItems);
  const failedItems = explicitLeadFailures > 0
    ? explicitLeadFailures
    : Math.max(
        0,
        toNonNegativeCount(payload.failedItems) - toNonNegativeCount(payload.disqualified),
      );

  return {
    totalItems,
    processedItems: toNonNegativeCount(payload.processedItems),
    failedItems,
  };
}

function mapDashboardRunStatus(status: DashboardJobStatus, failedItems: number): DashboardRunStatus {
  switch (status) {
    case 'queued':
      return 'QUEUED';
    case 'running':
      return 'RUNNING';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    case 'completed':
    default:
      return failedItems > 0 ? 'PARTIAL' : 'SUCCEEDED';
  }
}

function deriveDashboardRunStage(result: Record<string, unknown>, status: DashboardJobStatus): string | null {
  if (status !== 'running') return null;
  return result.searchTasksComplete ? 'processing' : 'searching';
}

function buildEmptyScoreHistogram(): ScoreDistributionResponse['histogram'] {
  return Array.from({ length: 10 }, (_, index) => ({
    scoreMin: index / 10,
    scoreMax: (index + 1) / 10,
    count: 0,
  }));
}

function buildScoreHistogramFromScores(scores: number[]): ScoreDistributionResponse['histogram'] {
  const histogram = buildEmptyScoreHistogram();

  for (const score of scores) {
    if (!Number.isFinite(score)) continue;

    const bucketIndex = Math.min(Math.max(Math.floor(score * 10), 0), 9);
    histogram[bucketIndex]!.count += 1;
  }

  return histogram;
}

function buildScoreHistogramFromRows(rows: ScoreHistogramRow[]): ScoreDistributionResponse['histogram'] {
  const histogram = buildEmptyScoreHistogram();

  for (const row of rows) {
    const bucketIndex = toNonNegativeInt(row.bucketIndex);
    if (bucketIndex < 0 || bucketIndex >= histogram.length) continue;

    histogram[bucketIndex]!.count = toNonNegativeInt(row.count);
  }

  return histogram;
}

function emptyDashboardRollupTotals(): DashboardRollupTotals {
  return {
    discoveredCount: 0,
    qualifiedCount: 0,
    enrichedCount: 0,
    scoredCount: 0,
    scoreSum: 0,
    lowScoreCount: 0,
    mediumScoreCount: 0,
    highScoreCount: 0,
    scoreBucketCounts: Array.from({ length: 10 }, () => 0),
    messagesGeneratedCount: 0,
    sentCount: 0,
    failedCount: 0,
    repliedCount: 0,
    meetingsCount: 0,
    dealsWonCount: 0,
    dealLostCount: 0,
    bouncedCount: 0,
    notInterestedCount: 0,
    rejectedCount: 0,
    totalCostCents: 0,
  };
}

function addDashboardRollup(total: DashboardRollupTotals, row: DashboardRollupRow): void {
  total.discoveredCount += row.discoveredCount;
  total.qualifiedCount += row.qualifiedCount;
  total.enrichedCount += row.enrichedCount;
  total.scoredCount += row.scoredCount;
  total.scoreSum += row.scoreSum;
  total.lowScoreCount += row.lowScoreCount;
  total.mediumScoreCount += row.mediumScoreCount;
  total.highScoreCount += row.highScoreCount;
  total.scoreBucketCounts[0]! += row.scoreBucket0Count;
  total.scoreBucketCounts[1]! += row.scoreBucket1Count;
  total.scoreBucketCounts[2]! += row.scoreBucket2Count;
  total.scoreBucketCounts[3]! += row.scoreBucket3Count;
  total.scoreBucketCounts[4]! += row.scoreBucket4Count;
  total.scoreBucketCounts[5]! += row.scoreBucket5Count;
  total.scoreBucketCounts[6]! += row.scoreBucket6Count;
  total.scoreBucketCounts[7]! += row.scoreBucket7Count;
  total.scoreBucketCounts[8]! += row.scoreBucket8Count;
  total.scoreBucketCounts[9]! += row.scoreBucket9Count;
  total.messagesGeneratedCount += row.messagesGeneratedCount;
  total.sentCount += row.sentCount;
  total.failedCount += row.failedCount;
  total.repliedCount += row.repliedCount;
  total.meetingsCount += row.meetingsCount;
  total.dealsWonCount += row.dealsWonCount;
  total.dealLostCount += row.dealLostCount;
  total.bouncedCount += row.bouncedCount;
  total.notInterestedCount += row.notInterestedCount;
  total.rejectedCount += row.rejectedCount;
  total.totalCostCents += row.totalCostCents;
}

function summarizeDashboardRollups(rows: DashboardRollupRow[]): DashboardRollupTotals {
  const totals = emptyDashboardRollupTotals();
  for (const row of rows) {
    addDashboardRollup(totals, row);
  }
  return totals;
}

function buildRollupScoreHistogram(bucketCounts: number[]): ScoreDistributionResponse['histogram'] {
  return bucketCounts.map((count, index) => ({
    scoreMin: index / 10,
    scoreMax: (index + 1) / 10,
    count,
  }));
}

function buildRollupQualityTrends(rows: DashboardRollupRow[]): DailyQualityTrendsResponse['items'] {
  const byDay = new Map<string, DashboardRollupTotals>();

  for (const row of rows) {
    const day = row.day.toISOString().slice(0, 10);
    const total = byDay.get(day) ?? emptyDashboardRollupTotals();
    addDashboardRollup(total, row);
    byDay.set(day, total);
  }

  return Array.from(byDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, total]) => ({
      day,
      avgScore: total.scoredCount > 0 ? total.scoreSum / total.scoredCount : 0,
      totalCreated: total.discoveredCount,
      rejectedCount: total.rejectedCount,
    }));
}

function buildRollupIcpPerformance(rows: DashboardRollupRow[]): IcpPerformanceResponse['items'] {
  const byIcp = new Map<string, DashboardRollupTotals>();

  for (const row of rows) {
    const total = byIcp.get(row.icpProfileId) ?? emptyDashboardRollupTotals();
    addDashboardRollup(total, row);
    byIcp.set(row.icpProfileId, total);
  }

  return Array.from(byIcp.entries())
    .map(([icpProfileId, total]) => ({
      icpProfileId,
      leadCount: total.scoredCount,
      avgScore: total.scoredCount > 0 ? total.scoreSum / total.scoredCount : null,
      qualifiedCount: total.qualifiedCount,
      rejectedCount: total.rejectedCount,
    }))
    .sort((left, right) => right.leadCount - left.leadCount || left.icpProfileId.localeCompare(right.icpProfileId));
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
    const latestScoresCte = `
      with latest_scores as (
        select distinct on ("leadId")
          "leadId",
          "scoreBand",
          "blendedScore"
        from public."LeadScorePrediction"
        ${whereClause}
        order by "leadId", "predictedAt" desc, "createdAt" desc
      )
    `;
    const [bandResult, histogramResult] = await Promise.all([
      dbQuery<ScoreDistributionRow>(
        `
          ${latestScoresCte}
          select
            "scoreBand" as "scoreBand",
            count(*)::integer as count
          from latest_scores
          group by "scoreBand"
        `,
        values,
      ),
      dbQuery<ScoreHistogramRow>(
        `
          ${latestScoresCte}
          select
            least(floor("blendedScore" * 10)::integer, 9) as "bucketIndex",
            count(*)::integer as count
          from latest_scores
          where "blendedScore" is not null
          group by 1
          order by 1 asc
        `,
        values,
      ),
    ]);

    const bands = SCORE_BAND_ORDER.map((scoreBand) => {
      const match = bandResult.rows.find((row) => row.scoreBand === scoreBand);
      return {
        scoreBand,
        count: toNonNegativeInt(match?.count ?? 0),
      };
    });

    return {
      bands,
      histogram: buildScoreHistogramFromRows(histogramResult.rows),
    };
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

  override async getAvgScore(input: AvgScoreQuery): Promise<AvgScoreResponse> {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const icpProfileId = input.icpProfileId ?? null;

    const result = await dbQuery<AvgScoreAggregateRow>(
      `
        with latest_scores as (
          select distinct on ("leadId")
            "leadId",
            "blendedScore"
          from public."LeadScorePrediction"
          where ($1::timestamp is null or "predictedAt" >= $1)
            and ($2::timestamp is null or "predictedAt" <= $2)
            and ($3::text is null or "icpProfileId" = $3)
          order by "leadId", "predictedAt" desc, "createdAt" desc
        )
        select
          avg("blendedScore")::double precision as "avgScore"
        from latest_scores
      `,
      [from, to, icpProfileId],
    );

    const rawAvgScore = result.rows[0]?.avgScore;
    const avgScore = rawAvgScore === null || rawAvgScore === undefined ? null : Number(rawAvgScore);

    return {
      avgScore: avgScore !== null && Number.isFinite(avgScore) ? avgScore : null,
    };
  }

  override async getIcpPerformance(input: IcpPerformanceQuery): Promise<IcpPerformanceResponse> {
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    const icpProfileId = input.icpProfileId ?? null;

    const result = await dbQuery<IcpPerformanceAggregateRow>(
      `
        with latest_scores as (
          select distinct on (sp."leadId", sp."icpProfileId")
            sp."leadId",
            sp."icpProfileId",
            sp."blendedScore"
          from public."LeadScorePrediction" sp
          where ($1::timestamp is null or sp."predictedAt" >= $1)
            and ($2::timestamp is null or sp."predictedAt" <= $2)
            and ($3::text is null or sp."icpProfileId" = $3)
          order by sp."leadId", sp."icpProfileId", sp."predictedAt" desc, sp."createdAt" desc
        ),
        scored as (
          select
            latest_scores."icpProfileId" as "icpProfileId",
            count(*)::integer as "leadCount",
            avg(latest_scores."blendedScore")::double precision as "avgScore"
          from latest_scores
          group by latest_scores."icpProfileId"
        ),
        qualified as (
          select
            latest_scores."icpProfileId" as "icpProfileId",
            count(*)::integer as "qualifiedCount"
          from latest_scores
          join public."Lead" lead
            on lead."id" = latest_scores."leadId"
          where lead."deletedAt" is null
            and lead."status" in ('qualified', 'drafted', 'messaged', 'replied', 'cold')
          group by latest_scores."icpProfileId"
        ),
        rejections as (
          select
            lr."icpProfileId" as "icpProfileId",
            count(*)::integer as "rejectedCount"
          from public."lead_rejections" lr
          where lr."icpProfileId" is not null
            and ($1::timestamp is null or lr."rejectedAt" >= $1)
            and ($2::timestamp is null or lr."rejectedAt" <= $2)
            and ($3::text is null or lr."icpProfileId" = $3)
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
      [from, to, icpProfileId],
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
