import { randomUUID } from 'node:crypto';

import { prisma } from '@lead-flood/db';
import type { Job } from 'pg-boss';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleAnalyticsRollupJob,
  type AnalyticsRollupJobPayload,
} from '../../src/jobs/analytics.rollup.job.js';

function makeJob<T>(data: T, name = 'test'): Job<T> {
  return {
    id: randomUUID(),
    name,
    data,
    priority: 0,
    state: 'active',
    retrylimit: 0,
    retrycount: 0,
    retrydelay: 0,
    retrybackoff: false,
    startafter: new Date(),
    startedon: new Date(),
    singletonkey: null,
    singletonon: null,
    expirein: { hours: 1 },
    createdon: new Date(),
    completedon: null,
    keepuntil: new Date(Date.now() + 86_400_000),
    on_complete: false,
    output: null,
    deadletter: null,
  } as unknown as Job<T>;
}

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('analytics rollup dashboard metrics integration', () => {
  const createdIcpIds: string[] = [];
  const createdLeadIds: string[] = [];
  const createdDraftIds: string[] = [];
  const createdTrainingRunIds: string[] = [];
  const createdModelVersionIds: string[] = [];

  afterEach(async () => {
    if (createdIcpIds.length > 0) {
      await prisma.analyticsDailyRollup.deleteMany({
        where: { icpProfileId: { in: createdIcpIds } },
      });
      await prisma.leadRejection.deleteMany({
        where: { icpProfileId: { in: createdIcpIds } },
      });
    }

    if (createdLeadIds.length > 0) {
      await prisma.feedbackEvent.deleteMany({
        where: { leadId: { in: createdLeadIds } },
      });
      await prisma.messageSend.deleteMany({
        where: { leadId: { in: createdLeadIds } },
      });
      await prisma.leadScorePrediction.deleteMany({
        where: { leadId: { in: createdLeadIds } },
      });
      await prisma.leadFeatureSnapshot.deleteMany({
        where: { leadId: { in: createdLeadIds } },
      });
      await prisma.leadDiscoveryRecord.deleteMany({
        where: { leadId: { in: createdLeadIds } },
      });
    }

    if (createdDraftIds.length > 0) {
      await prisma.messageVariant.deleteMany({
        where: { messageDraftId: { in: createdDraftIds } },
      });
      await prisma.messageDraft.deleteMany({
        where: { id: { in: createdDraftIds } },
      });
    }

    if (createdLeadIds.length > 0) {
      await prisma.lead.deleteMany({
        where: { id: { in: createdLeadIds } },
      });
    }

    if (createdModelVersionIds.length > 0) {
      await prisma.modelVersion.deleteMany({
        where: { id: { in: createdModelVersionIds } },
      });
    }

    if (createdTrainingRunIds.length > 0) {
      await prisma.trainingRun.deleteMany({
        where: { id: { in: createdTrainingRunIds } },
      });
    }

    if (createdIcpIds.length > 0) {
      await prisma.icpProfile.deleteMany({
        where: { id: { in: createdIcpIds } },
      });
    }

    createdIcpIds.splice(0, createdIcpIds.length);
    createdLeadIds.splice(0, createdLeadIds.length);
    createdDraftIds.splice(0, createdDraftIds.length);
    createdTrainingRunIds.splice(0, createdTrainingRunIds.length);
    createdModelVersionIds.splice(0, createdModelVersionIds.length);
  });

  it('precomputes score bands, funnel totals, outcomes, and ICP metrics', async () => {
    const suffix = randomUUID();
    const day = '2026-07-08';
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const midday = new Date(`${day}T12:00:00.000Z`);
    const icp = await prisma.icpProfile.create({
      data: {
        name: `Rollup dashboard ICP ${suffix}`,
        qualificationLogic: 'WEIGHTED',
        targetIndustries: ['Technology'],
        targetCountries: ['US'],
        isActive: true,
      },
    });
    createdIcpIds.push(icp.id);

    const trainingRun = await prisma.trainingRun.create({
      data: {
        modelType: 'LOGISTIC_REGRESSION',
        status: 'SUCCEEDED',
        trigger: 'MANUAL',
        configJson: {},
        trainingWindowStart: dayStart,
        trainingWindowEnd: midday,
        datasetSize: 2,
        positiveCount: 1,
        negativeCount: 1,
      },
    });
    createdTrainingRunIds.push(trainingRun.id);

    const modelVersion = await prisma.modelVersion.create({
      data: {
        trainingRunId: trainingRun.id,
        modelType: 'LOGISTIC_REGRESSION',
        versionTag: `rollup-dashboard-${suffix}`,
        stage: 'SHADOW',
        featureSchemaJson: {},
        deterministicWeightsJson: {},
        checksum: `rollup-dashboard-${suffix}`,
        trainedAt: midday,
      },
    });
    createdModelVersionIds.push(modelVersion.id);

    const leadA = await prisma.lead.create({
      data: {
        firstName: 'Rollup',
        lastName: 'Alpha',
        email: `rollup-alpha-${suffix}@example.com`,
        source: 'test',
        status: 'qualified',
        costCents: 125,
      },
    });
    const leadB = await prisma.lead.create({
      data: {
        firstName: 'Rollup',
        lastName: 'Beta',
        email: `rollup-beta-${suffix}@example.net`,
        source: 'test',
        status: 'replied',
        costCents: 175,
      },
    });
    createdLeadIds.push(leadA.id, leadB.id);

    await prisma.leadDiscoveryRecord.createMany({
      data: [
        {
          leadId: leadA.id,
          icpProfileId: icp.id,
          provider: 'APOLLO',
          providerRecordId: `apollo-alpha-${suffix}`,
          queryHash: `rollup-${suffix}`,
          status: 'DISCOVERED',
          rawPayload: {},
          discoveredAt: midday,
        },
        {
          leadId: leadB.id,
          icpProfileId: icp.id,
          provider: 'APOLLO',
          providerRecordId: `apollo-beta-${suffix}`,
          queryHash: `rollup-${suffix}`,
          status: 'DISCOVERED',
          rawPayload: {},
          discoveredAt: midday,
        },
      ],
    });

    const snapshotA = await prisma.leadFeatureSnapshot.create({
      data: {
        leadId: leadA.id,
        icpProfileId: icp.id,
        snapshotVersion: 1,
        sourceVersion: 'test',
        featureVectorHash: `alpha-${suffix}`,
        featuresJson: {
          industry_match: true,
          geo_match: true,
        },
        ruleMatchCount: 2,
        hardFilterPassed: true,
        computedAt: midday,
      },
    });
    const snapshotB = await prisma.leadFeatureSnapshot.create({
      data: {
        leadId: leadB.id,
        icpProfileId: icp.id,
        snapshotVersion: 1,
        sourceVersion: 'test',
        featureVectorHash: `beta-${suffix}`,
        featuresJson: {
          industry_match: false,
          geo_match: true,
        },
        ruleMatchCount: 1,
        hardFilterPassed: true,
        computedAt: midday,
      },
    });

    await prisma.leadScorePrediction.createMany({
      data: [
        {
          leadId: leadA.id,
          icpProfileId: icp.id,
          featureSnapshotId: snapshotA.id,
          modelVersionId: modelVersion.id,
          deterministicScore: 0.9,
          logisticScore: 0.94,
          blendedScore: 0.92,
          scoreBand: 'HIGH',
          reasonsJson: {},
          predictedAt: midday,
        },
        {
          leadId: leadB.id,
          icpProfileId: icp.id,
          featureSnapshotId: snapshotB.id,
          modelVersionId: modelVersion.id,
          deterministicScore: 0.5,
          logisticScore: 0.58,
          blendedScore: 0.54,
          scoreBand: 'MEDIUM',
          reasonsJson: {},
          predictedAt: midday,
        },
      ],
    });

    const draftA = await prisma.messageDraft.create({
      data: {
        leadId: leadA.id,
        icpProfileId: icp.id,
        promptVersion: 'test',
        generatedByModel: 'test-model',
        approvalStatus: 'APPROVED',
        createdAt: midday,
        variants: {
          create: {
            variantKey: 'primary',
            channel: 'EMAIL',
            bodyText: 'A focused test message for rollup metrics.',
            isSelected: true,
          },
        },
      },
      include: { variants: true },
    });
    const draftB = await prisma.messageDraft.create({
      data: {
        leadId: leadB.id,
        icpProfileId: icp.id,
        promptVersion: 'test',
        generatedByModel: 'test-model',
        approvalStatus: 'APPROVED',
        createdAt: midday,
        variants: {
          create: {
            variantKey: 'primary',
            channel: 'EMAIL',
            bodyText: 'A second focused test message for rollup metrics.',
            isSelected: true,
          },
        },
      },
      include: { variants: true },
    });
    createdDraftIds.push(draftA.id, draftB.id);

    await prisma.messageSend.createMany({
      data: [
        {
          leadId: leadA.id,
          messageDraftId: draftA.id,
          messageVariantId: draftA.variants[0]!.id,
          channel: 'EMAIL',
          provider: 'RESEND',
          status: 'SENT',
          idempotencyKey: `rollup-sent-${suffix}`,
          sentAt: midday,
        },
        {
          leadId: leadB.id,
          messageDraftId: draftB.id,
          messageVariantId: draftB.variants[0]!.id,
          channel: 'EMAIL',
          provider: 'RESEND',
          status: 'FAILED',
          idempotencyKey: `rollup-failed-${suffix}`,
          createdAt: midday,
        },
      ],
    });

    await prisma.feedbackEvent.createMany({
      data: [
        {
          leadId: leadA.id,
          eventType: 'REPLIED',
          source: 'WEBHOOK',
          dedupeKey: `rollup-replied-${suffix}`,
          occurredAt: midday,
        },
        {
          leadId: leadA.id,
          eventType: 'MEETING_BOOKED',
          source: 'MANUAL',
          dedupeKey: `rollup-meeting-${suffix}`,
          occurredAt: midday,
        },
        {
          leadId: leadA.id,
          eventType: 'DEAL_WON',
          source: 'MANUAL',
          dedupeKey: `rollup-won-${suffix}`,
          occurredAt: midday,
        },
        {
          leadId: leadB.id,
          eventType: 'DEAL_LOST',
          source: 'MANUAL',
          dedupeKey: `rollup-lost-${suffix}`,
          occurredAt: midday,
        },
        {
          leadId: leadB.id,
          eventType: 'BOUNCED',
          source: 'WEBHOOK',
          dedupeKey: `rollup-bounced-${suffix}`,
          occurredAt: midday,
        },
        {
          leadId: leadB.id,
          eventType: 'UNSUBSCRIBED',
          source: 'WEBHOOK',
          dedupeKey: `rollup-unsubscribed-${suffix}`,
          occurredAt: midday,
        },
      ],
    });

    await prisma.leadRejection.create({
      data: {
        leadId: leadB.id,
        icpProfileId: icp.id,
        score: 0.54,
        reason: 'test-rejection',
        rejectedBy: 'test',
        rejectedAt: midday,
      },
    });

    const payload: AnalyticsRollupJobPayload = {
      runId: `rollup-dashboard-${suffix}`,
      day,
      icpProfileId: icp.id,
      fullRecompute: false,
      correlationId: `corr-${suffix}`,
    };

    await handleAnalyticsRollupJob(noopLogger, makeJob(payload, 'analytics.rollup'));

    const rollup = await prisma.analyticsDailyRollup.findUniqueOrThrow({
      where: {
        day_icpProfileId: {
          day: dayStart,
          icpProfileId: icp.id,
        },
      },
    });

    expect(rollup.discoveredCount).toBe(2);
    expect(rollup.qualifiedCount).toBe(2);
    expect(rollup.validEmailCount).toBe(2);
    expect(rollup.validDomainCount).toBe(2);
    expect(rollup.totalCostCents).toBe(300);
    expect(rollup.scoredCount).toBe(2);
    expect(rollup.scoreSum).toBeCloseTo(1.46);
    expect(rollup.lowScoreCount).toBe(0);
    expect(rollup.mediumScoreCount).toBe(1);
    expect(rollup.highScoreCount).toBe(1);
    expect(rollup.scoreBucket5Count).toBe(1);
    expect(rollup.scoreBucket9Count).toBe(1);
    expect(rollup.industryMatchRate).toBe(0.5);
    expect(rollup.geoMatchRate).toBe(1);
    expect(rollup.messagesGeneratedCount).toBe(2);
    expect(rollup.sentCount).toBe(1);
    expect(rollup.failedCount).toBe(1);
    expect(rollup.repliedCount).toBe(1);
    expect(rollup.meetingsCount).toBe(1);
    expect(rollup.dealsWonCount).toBe(1);
    expect(rollup.dealLostCount).toBe(1);
    expect(rollup.bouncedCount).toBe(1);
    expect(rollup.notInterestedCount).toBe(1);
    expect(rollup.rejectedCount).toBe(1);
  });
});
