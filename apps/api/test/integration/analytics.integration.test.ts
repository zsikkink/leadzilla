import { prisma, query as dbQuery } from '@lead-flood/db';
import { createLogger } from '@lead-flood/observability';
import { afterEach, describe, expect, it } from 'vitest';

import type { ApiEnv } from '../../src/env.js';
import { buildServer } from '../../src/server.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/lead_flood';
process.env.DATABASE_URL = databaseUrl;
const directUrl = process.env.DIRECT_URL ?? databaseUrl;
process.env.DIRECT_URL = directUrl;

const env: ApiEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  API_PORT: 5050,
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'error',
  PG_BOSS_SCHEMA: 'pgboss',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl,
  APOLLO_API_KEY: 'apollo-test-key',
  PDL_API_KEY: 'pdl-test-key',
  DISCOVERY_ENABLED: true,
  ENRICHMENT_ENABLED: true,
};

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-token' };
}

function createUniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildTestServer() {
  return buildServer({
    env,
    logger: createLogger({ service: 'api-test', env: 'test', level: 'error' }),
    verifyAccessToken: async () => ({ sub: 'user_1', email: null, firstName: null, lastName: null }),
    checkDatabaseHealth: async () => true,
    checkSchemaHealth: async () => ({ status: 'ok', missingTables: [], missingEnumValues: [] }),
    authenticateUser: async () => null,
    createLeadAndEnqueue: async () => ({ leadId: 'lead_1', jobId: 'job_1' }),
    getLeadById: async () => null,
    listLeads: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    listContactRecoveryItems: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    getContactRecoveryItem: async () => null,
    rejectContactRecoveryItem: async () => null,
    getJobById: async () => null,
  });
}

async function ensureRecommendationTableForTest(): Promise<void> {
  await dbQuery(
    `
      create table if not exists public."manager_recommendation_records" (
        "id" text not null,
        "type" text not null,
        "title" text not null,
        "description" text not null,
        "icpProfileId" text,
        "icpName" text,
        "field" text,
        "currentValue" double precision,
        "recommendedValue" double precision,
        "confidence" double precision default 0 not null,
        "priority" integer default 5 not null,
        "status" text default 'active' not null,
        "analysisRunId" text,
        "createdAt" timestamp(3) without time zone default CURRENT_TIMESTAMP not null,
        "updatedAt" timestamp(3) without time zone not null,
        constraint "manager_recommendation_records_pkey" primary key ("id")
      )
    `,
  );
}

async function createScorePredictionFixture(input: {
  icpProfileId: string;
  modelVersionId: string;
  scoreBand: 'LOW' | 'MEDIUM' | 'HIGH';
  createdLeadIds: string[];
  label: string;
}): Promise<void> {
  const token = createUniqueToken(input.label);
  const leadId = createUniqueToken('analytics-lead');
  const now = new Date();
  const leadResult = await dbQuery<{ id: string }>(
    `
      insert into public."Lead" (
        "id",
        "firstName",
        "lastName",
        "email",
        "source",
        "status",
        "createdAt",
        "updatedAt"
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id
    `,
    [leadId, 'Analytics', input.label, `${token}@lead-flood.local`, 'analytics-integration', 'enriched', now, now],
  );
  const insertedLeadId = leadResult.rows[0]?.id;
  if (!insertedLeadId) {
    throw new Error('Failed to insert analytics score distribution lead fixture');
  }
  input.createdLeadIds.push(insertedLeadId);

  const featureSnapshot = await prisma.leadFeatureSnapshot.create({
    data: {
      leadId: insertedLeadId,
      icpProfileId: input.icpProfileId,
      snapshotVersion: 1,
      sourceVersion: 'features_v1',
      featureVectorHash: `${token}-hash`,
      featuresJson: { fixture: input.label },
      ruleMatchCount: 1,
      hardFilterPassed: true,
    },
  });

  const blendedScore = input.scoreBand === 'HIGH' ? 0.9 : input.scoreBand === 'MEDIUM' ? 0.5 : 0.1;

  await prisma.leadScorePrediction.create({
    data: {
      leadId: insertedLeadId,
      icpProfileId: input.icpProfileId,
      featureSnapshotId: featureSnapshot.id,
      modelVersionId: input.modelVersionId,
      deterministicScore: blendedScore,
      logisticScore: 1 - blendedScore,
      blendedScore,
      scoreBand: input.scoreBand,
      reasonsJson: { reasonCodes: [`FIXTURE_${input.scoreBand}`] },
    },
  });
}

async function createStoredRecommendationFixture(input: {
  createdRecommendationIds: string[];
  type: string;
  title: string;
  description: string;
  icpProfileId?: string | null;
  icpName?: string | null;
  field?: string | null;
  currentValue?: number | null;
  recommendedValue?: number | null;
  confidence: number;
  priority: number;
  status: 'active' | 'dismissed' | 'applied';
  analysisRunId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
}): Promise<string> {
  await ensureRecommendationTableForTest();

  const id = createUniqueToken('analytics-recommendation');
  await dbQuery(
    `
      insert into public."manager_recommendation_records" (
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
        "createdAt",
        "updatedAt"
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
    `,
    [
      id,
      input.type,
      input.title,
      input.description,
      input.icpProfileId ?? null,
      input.icpName ?? null,
      input.field ?? null,
      input.currentValue ?? null,
      input.recommendedValue ?? null,
      input.confidence,
      input.priority,
      input.status,
      input.analysisRunId ?? null,
      input.createdAt,
      input.updatedAt ?? input.createdAt,
    ],
  );

  input.createdRecommendationIds.push(id);
  return id;
}

describe('analytics score distribution integration', () => {
  const createdLeadIds: string[] = [];
  const createdIcpIds: string[] = [];
  const createdTrainingRunIds: string[] = [];
  const createdModelVersionIds: string[] = [];

  afterEach(async () => {
    if (createdLeadIds.length > 0) {
      const leadIds = createdLeadIds.splice(0);
      await dbQuery(`delete from public."Lead" where id = any($1::text[])`, [leadIds]);
    }

    if (createdModelVersionIds.length > 0) {
      await prisma.modelVersion.deleteMany({ where: { id: { in: createdModelVersionIds.splice(0) } } });
    }

    if (createdTrainingRunIds.length > 0) {
      await prisma.trainingRun.deleteMany({ where: { id: { in: createdTrainingRunIds.splice(0) } } });
    }

    if (createdIcpIds.length > 0) {
      await prisma.icpProfile.deleteMany({ where: { id: { in: createdIcpIds.splice(0) } } });
    }
  });

  it('returns fixed band ordering with zero-fill and respects icp/model filters', async () => {
    const primaryIcp = await prisma.icpProfile.create({
      data: {
        name: createUniqueToken('analytics-primary-icp'),
        isActive: true,
        targetIndustries: ['retail'],
        targetCountries: ['us'],
        requiredTechnologies: ['shopify'],
      },
    });
    createdIcpIds.push(primaryIcp.id);

    const secondaryIcp = await prisma.icpProfile.create({
      data: {
        name: createUniqueToken('analytics-secondary-icp'),
        isActive: true,
        targetIndustries: ['saas'],
        targetCountries: ['us'],
        requiredTechnologies: ['hubspot'],
      },
    });
    createdIcpIds.push(secondaryIcp.id);

    const trainingRun = await prisma.trainingRun.create({
      data: {
        modelType: 'LOGISTIC_REGRESSION',
        status: 'SUCCEEDED',
        trigger: 'MANUAL',
        configJson: { fixture: true },
        trainingWindowStart: new Date(Date.now() - 86_400_000),
        trainingWindowEnd: new Date(),
        startedAt: new Date(),
        endedAt: new Date(),
      },
    });
    createdTrainingRunIds.push(trainingRun.id);

    const primaryModelVersion = await prisma.modelVersion.create({
      data: {
        trainingRunId: trainingRun.id,
        modelType: 'LOGISTIC_REGRESSION',
        versionTag: createUniqueToken('analytics-model-a'),
        stage: 'ACTIVE',
        featureSchemaJson: { sourceVersion: 'features_v1' },
        deterministicWeightsJson: {},
        checksum: createUniqueToken('analytics-checksum-a'),
      },
    });
    createdModelVersionIds.push(primaryModelVersion.id);

    const secondaryModelVersion = await prisma.modelVersion.create({
      data: {
        trainingRunId: trainingRun.id,
        modelType: 'LOGISTIC_REGRESSION',
        versionTag: createUniqueToken('analytics-model-b'),
        stage: 'SHADOW',
        featureSchemaJson: { sourceVersion: 'features_v1' },
        deterministicWeightsJson: {},
        checksum: createUniqueToken('analytics-checksum-b'),
      },
    });
    createdModelVersionIds.push(secondaryModelVersion.id);

    await createScorePredictionFixture({
      icpProfileId: primaryIcp.id,
      modelVersionId: primaryModelVersion.id,
      scoreBand: 'LOW',
      createdLeadIds,
      label: 'primary-a-low',
    });
    await createScorePredictionFixture({
      icpProfileId: primaryIcp.id,
      modelVersionId: primaryModelVersion.id,
      scoreBand: 'HIGH',
      createdLeadIds,
      label: 'primary-a-high-1',
    });
    await createScorePredictionFixture({
      icpProfileId: primaryIcp.id,
      modelVersionId: primaryModelVersion.id,
      scoreBand: 'HIGH',
      createdLeadIds,
      label: 'primary-a-high-2',
    });
    await createScorePredictionFixture({
      icpProfileId: primaryIcp.id,
      modelVersionId: secondaryModelVersion.id,
      scoreBand: 'MEDIUM',
      createdLeadIds,
      label: 'primary-b-medium',
    });
    await createScorePredictionFixture({
      icpProfileId: secondaryIcp.id,
      modelVersionId: primaryModelVersion.id,
      scoreBand: 'LOW',
      createdLeadIds,
      label: 'secondary-a-low',
    });

    const server = buildTestServer();

    try {
      const primaryModelResponse = await server.inject({
        method: 'GET',
        url: `/v1/analytics/score-distribution?icpProfileId=${primaryIcp.id}&modelVersionId=${primaryModelVersion.id}`,
        headers: authHeaders(),
      });

      expect(primaryModelResponse.statusCode).toBe(200);
      expect(primaryModelResponse.json()).toEqual({
        bands: [
          { scoreBand: 'LOW', count: 1 },
          { scoreBand: 'MEDIUM', count: 0 },
          { scoreBand: 'HIGH', count: 2 },
        ],
      });

      const primaryIcpResponse = await server.inject({
        method: 'GET',
        url: `/v1/analytics/score-distribution?icpProfileId=${primaryIcp.id}`,
        headers: authHeaders(),
      });

      expect(primaryIcpResponse.statusCode).toBe(200);
      expect(primaryIcpResponse.json()).toEqual({
        bands: [
          { scoreBand: 'LOW', count: 1 },
          { scoreBand: 'MEDIUM', count: 1 },
          { scoreBand: 'HIGH', count: 2 },
        ],
      });

      const primaryModelOnlyResponse = await server.inject({
        method: 'GET',
        url: `/v1/analytics/score-distribution?modelVersionId=${primaryModelVersion.id}`,
        headers: authHeaders(),
      });

      expect(primaryModelOnlyResponse.statusCode).toBe(200);
      expect(primaryModelOnlyResponse.json()).toEqual({
        bands: [
          { scoreBand: 'LOW', count: 2 },
          { scoreBand: 'MEDIUM', count: 0 },
          { scoreBand: 'HIGH', count: 2 },
        ],
      });
    } finally {
      await server.close();
    }
  });
});

describe('analytics stored recommendations integration', () => {
  const createdRecommendationIds: string[] = [];

  afterEach(async () => {
    if (createdRecommendationIds.length > 0) {
      const recommendationIds = createdRecommendationIds.splice(0);
      await dbQuery(
        `delete from public."manager_recommendation_records" where id = any($1::text[])`,
        [recommendationIds],
      );
    }
  });

  it('returns ordered recommendations and respects status, icp, and limit filters', async () => {
    const icpAlpha = createUniqueToken('icp-alpha');
    const icpBeta = createUniqueToken('icp-beta');

    const firstActive = await createStoredRecommendationFixture({
      createdRecommendationIds,
      type: 'ADJUST_WEIGHT',
      title: 'Raise intent weighting',
      description: 'Increase weight for intent signals',
      icpProfileId: icpAlpha,
      icpName: 'ICP Alpha',
      field: 'intentScore',
      currentValue: 0.2,
      recommendedValue: 0.35,
      confidence: 0.91,
      priority: 1,
      status: 'active',
      createdAt: new Date('2026-03-18T12:00:00.000Z'),
    });

    const secondPriority = await createStoredRecommendationFixture({
      createdRecommendationIds,
      type: 'PREFER_VARIANT',
      title: 'Prefer variant B',
      description: 'Variant B outperforms current default',
      icpProfileId: icpBeta,
      icpName: 'ICP Beta',
      field: 'variantKey',
      currentValue: null,
      recommendedValue: null,
      confidence: 0.88,
      priority: 1,
      status: 'dismissed',
      createdAt: new Date('2026-03-18T10:00:00.000Z'),
    });

    const thirdPriority = await createStoredRecommendationFixture({
      createdRecommendationIds,
      type: 'INCREASE_VOLUME',
      title: 'Increase send volume',
      description: 'Daily capacity remains under target',
      icpProfileId: icpAlpha,
      icpName: 'ICP Alpha',
      field: 'dailyVolume',
      currentValue: 40,
      recommendedValue: 55,
      confidence: 0.72,
      priority: 2,
      status: 'active',
      createdAt: new Date('2026-03-18T11:00:00.000Z'),
    });

    const fourthPriority = await createStoredRecommendationFixture({
      createdRecommendationIds,
      type: 'PAUSE_ICP',
      title: 'Pause low-yield ICP',
      description: 'Reply quality is below threshold',
      icpProfileId: icpAlpha,
      icpName: 'ICP Alpha',
      field: null,
      currentValue: null,
      recommendedValue: null,
      confidence: 0.67,
      priority: 3,
      status: 'applied',
      createdAt: new Date('2026-03-18T09:00:00.000Z'),
    });

    const server = buildTestServer();

    try {
      const defaultResponse = await server.inject({
        method: 'GET',
        url: '/v1/analytics/recommendations',
        headers: authHeaders(),
      });

      expect(defaultResponse.statusCode).toBe(200);
      expect((defaultResponse.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([
        firstActive,
        secondPriority,
        thirdPriority,
        fourthPriority,
      ]);

      const statusResponse = await server.inject({
        method: 'GET',
        url: '/v1/analytics/recommendations?status=active',
        headers: authHeaders(),
      });

      expect(statusResponse.statusCode).toBe(200);
      expect((statusResponse.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([
        firstActive,
        thirdPriority,
      ]);

      const icpResponse = await server.inject({
        method: 'GET',
        url: `/v1/analytics/recommendations?icpProfileId=${icpAlpha}`,
        headers: authHeaders(),
      });

      expect(icpResponse.statusCode).toBe(200);
      expect((icpResponse.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([
        firstActive,
        thirdPriority,
        fourthPriority,
      ]);

      const limitedResponse = await server.inject({
        method: 'GET',
        url: '/v1/analytics/recommendations?limit=2',
        headers: authHeaders(),
      });

      expect(limitedResponse.statusCode).toBe(200);
      expect((limitedResponse.json() as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual([
        firstActive,
        secondPriority,
      ]);
    } finally {
      await server.close();
    }
  });
});

describe('analytics retrain status integration', () => {
  const createdTrainingRunIds: string[] = [];
  const createdModelVersionIds: string[] = [];

  afterEach(async () => {
    if (createdModelVersionIds.length > 0) {
      await prisma.modelVersion.deleteMany({ where: { id: { in: createdModelVersionIds.splice(0) } } });
    }

    if (createdTrainingRunIds.length > 0) {
      await prisma.trainingRun.deleteMany({ where: { id: { in: createdTrainingRunIds.splice(0) } } });
    }
  });

  it('preserves active/current/successful run selection semantics', async () => {
    const server = buildTestServer();

    try {
      const runningOlderCreatedAt = new Date('2099-01-05T09:00:00.000Z');
      const queuedNewerCreatedAt = new Date('2099-01-05T10:00:00.000Z');
      const earlierSuccessCreatedAt = new Date('2099-01-04T10:00:00.000Z');
      const earlierSuccessEndedAt = new Date('2099-01-07T08:00:00.000Z');
      const laterSuccessCreatedAt = new Date('2099-01-04T09:00:00.000Z');
      const laterSuccessEndedAt = new Date('2099-01-08T08:00:00.000Z');
      const olderActiveActivatedAt = new Date('2099-01-09T08:00:00.000Z');
      const newerActiveActivatedAt = new Date('2099-01-10T08:00:00.000Z');

      const runningOlder = await prisma.trainingRun.create({
        data: {
          modelType: 'LOGISTIC_REGRESSION',
          status: 'RUNNING',
          trigger: 'MANUAL',
          configJson: { fixture: 'running-older' },
          trainingWindowStart: new Date('2099-01-01T00:00:00.000Z'),
          trainingWindowEnd: new Date('2099-01-02T00:00:00.000Z'),
          startedAt: new Date('2099-01-05T09:05:00.000Z'),
          createdAt: runningOlderCreatedAt,
          updatedAt: runningOlderCreatedAt,
        },
      });
      createdTrainingRunIds.push(runningOlder.id);

      const queuedNewer = await prisma.trainingRun.create({
        data: {
          modelType: 'LOGISTIC_REGRESSION',
          status: 'QUEUED',
          trigger: 'SCHEDULED',
          configJson: { fixture: 'queued-newer' },
          trainingWindowStart: new Date('2099-01-02T00:00:00.000Z'),
          trainingWindowEnd: new Date('2099-01-03T00:00:00.000Z'),
          createdAt: queuedNewerCreatedAt,
          updatedAt: queuedNewerCreatedAt,
        },
      });
      createdTrainingRunIds.push(queuedNewer.id);

      const earlierSuccessful = await prisma.trainingRun.create({
        data: {
          modelType: 'LOGISTIC_REGRESSION',
          status: 'SUCCEEDED',
          trigger: 'MANUAL',
          configJson: { fixture: 'successful-earlier-ended' },
          trainingWindowStart: new Date('2099-01-03T00:00:00.000Z'),
          trainingWindowEnd: new Date('2099-01-04T00:00:00.000Z'),
          startedAt: new Date('2099-01-04T10:30:00.000Z'),
          endedAt: earlierSuccessEndedAt,
          createdAt: earlierSuccessCreatedAt,
          updatedAt: earlierSuccessEndedAt,
        },
      });
      createdTrainingRunIds.push(earlierSuccessful.id);

      const laterSuccessful = await prisma.trainingRun.create({
        data: {
          modelType: 'LOGISTIC_REGRESSION',
          status: 'SUCCEEDED',
          trigger: 'FEEDBACK_THRESHOLD',
          configJson: { fixture: 'successful-later-ended' },
          trainingWindowStart: new Date('2099-01-03T00:00:00.000Z'),
          trainingWindowEnd: new Date('2099-01-05T00:00:00.000Z'),
          startedAt: new Date('2099-01-04T09:30:00.000Z'),
          endedAt: laterSuccessEndedAt,
          createdAt: laterSuccessCreatedAt,
          updatedAt: laterSuccessEndedAt,
        },
      });
      createdTrainingRunIds.push(laterSuccessful.id);

      const olderActiveModel = await prisma.modelVersion.create({
        data: {
          trainingRunId: earlierSuccessful.id,
          modelType: 'LOGISTIC_REGRESSION',
          versionTag: createUniqueToken('analytics-retrain-active-old'),
          stage: 'ACTIVE',
          featureSchemaJson: { sourceVersion: 'features_v1' },
          deterministicWeightsJson: {},
          checksum: createUniqueToken('analytics-retrain-checksum-old'),
          activatedAt: olderActiveActivatedAt,
          createdAt: olderActiveActivatedAt,
          updatedAt: olderActiveActivatedAt,
        },
      });
      createdModelVersionIds.push(olderActiveModel.id);

      const newerActiveModel = await prisma.modelVersion.create({
        data: {
          trainingRunId: laterSuccessful.id,
          modelType: 'LOGISTIC_REGRESSION',
          versionTag: createUniqueToken('analytics-retrain-active-new'),
          stage: 'ACTIVE',
          featureSchemaJson: { sourceVersion: 'features_v1' },
          deterministicWeightsJson: {},
          checksum: createUniqueToken('analytics-retrain-checksum-new'),
          activatedAt: newerActiveActivatedAt,
          createdAt: newerActiveActivatedAt,
          updatedAt: newerActiveActivatedAt,
        },
      });
      createdModelVersionIds.push(newerActiveModel.id);

      const populatedResponse = await server.inject({
        method: 'GET',
        url: '/v1/analytics/retrain-status?modelType=LOGISTIC_REGRESSION',
        headers: authHeaders(),
      });

      expect(populatedResponse.statusCode).toBe(200);
      expect(populatedResponse.json()).toEqual({
        activeModelVersionId: newerActiveModel.id,
        currentRun: {
          trainingRunId: queuedNewer.id,
          status: 'QUEUED',
          startedAt: null,
          endedAt: null,
        },
        lastSuccessfulRun: {
          trainingRunId: laterSuccessful.id,
          endedAt: laterSuccessEndedAt.toISOString(),
        },
        nextScheduledAt: null,
      });
    } finally {
      await server.close();
    }
  });
});
