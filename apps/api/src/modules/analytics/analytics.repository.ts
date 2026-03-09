import type {
  FunnelQuery,
  FunnelResponse,
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
import { prisma } from '@lead-flood/db';

import { AnalyticsNotImplementedError } from './analytics.errors.js';

export interface AnalyticsRepository {
  getFunnel(query: FunnelQuery): Promise<FunnelResponse>;
  getScoreDistribution(query: ScoreDistributionQuery): Promise<ScoreDistributionResponse>;
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

    const rollupWhere = {
      ...(from || to
        ? {
            day: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
      ...(icpProfileId ? { icpProfileId } : {}),
    };

    const discoveryDateWhere = from || to
      ? {
          discoveredAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const enrichmentDateWhere = from || to
      ? {
          enrichedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

    const predictionDateWhere = from || to
      ? {
          predictedAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {};

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

    const rollupAgg = await prisma.analyticsDailyRollup.aggregate({
      where: rollupWhere,
      _sum: {
        discoveredCount: true,
        enrichedCount: true,
        scoredCount: true,
      },
    });

    const [
      discoveredCount,
      enrichedCount,
      scoredCount,
      messagesGeneratedCount,
      messagesSentCount,
      repliesCount,
      meetingsCount,
      dealsWonCount,
    ] = await Promise.all([
      prisma.leadDiscoveryRecord.count({
        where: {
          ...(icpProfileId ? { icpProfileId } : {}),
          ...discoveryDateWhere,
          status: 'DISCOVERED',
        },
      }),
      prisma.leadEnrichmentRecord.count({
        where: {
          ...enrichmentDateWhere,
          status: 'COMPLETED',
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
      prisma.leadScorePrediction.count({
        where: {
          ...(icpProfileId ? { icpProfileId } : {}),
          ...predictionDateWhere,
        },
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
          status: { in: ['SENT', 'DELIVERED', 'REPLIED'] },
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

    const qualifiedCount = rollupAgg._sum.discoveredCount ?? discoveredCount;

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
        orderBy: [{ activatedAt: 'desc' }, { createdAt: 'desc' }],
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
