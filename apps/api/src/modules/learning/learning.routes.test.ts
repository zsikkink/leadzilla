import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';
const enqueueModelTrain = vi.fn();

const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      trainingRun: {
        create: vi.fn(),
        update: vi.fn(),
      },
      modelVersion: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMocks.prisma,
  query: dbMocks.query,
}));

import { registerLearningRoutes } from './learning.routes.js';

describe('learning.routes authz', () => {
  let app: FastifyInstance;
  let currentUserId: string | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = NON_ADMIN_USER_ID;

    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });
    dbMocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof dbMocks.prisma) => Promise<unknown>) => callback(dbMocks.prisma),
    );
    dbMocks.prisma.trainingRun.create.mockResolvedValue({
      id: 'training_run_1',
      status: 'QUEUED',
    });
    dbMocks.prisma.trainingRun.update.mockResolvedValue({
      id: 'training_run_1',
      status: 'FAILED',
    });
    dbMocks.prisma.modelVersion.findUnique.mockResolvedValue({
      id: 'model_1',
      trainingRunId: 'training_run_1',
      modelType: 'LOGISTIC_REGRESSION',
      versionTag: 'v1',
      stage: 'SHADOW',
      featureSchemaJson: {},
      coefficientsJson: {},
      intercept: null,
      deterministicWeightsJson: {},
      artifactUri: null,
      checksum: 'checksum',
      trainedAt: new Date('2026-03-20T00:00:00.000Z'),
      activatedAt: null,
      retiredAt: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    dbMocks.prisma.modelVersion.updateMany.mockResolvedValue({ count: 0 });
    dbMocks.prisma.modelVersion.update.mockResolvedValue({
      id: 'model_1',
      trainingRunId: 'training_run_1',
      modelType: 'LOGISTIC_REGRESSION',
      versionTag: 'v1',
      stage: 'ACTIVE',
      featureSchemaJson: {},
      coefficientsJson: {},
      intercept: null,
      deterministicWeightsJson: {},
      artifactUri: null,
      checksum: 'checksum',
      trainedAt: new Date('2026-03-20T00:00:00.000Z'),
      activatedAt: new Date('2026-03-21T00:00:00.000Z'),
      retiredAt: null,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-21T00:00:00.000Z'),
    });

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      request.user = currentUserId
        ? {
            sub: currentUserId,
            email: null,
            firstName: null,
            lastName: null,
          }
        : null;
    });

    registerLearningRoutes(app, {
      enqueueModelTrain,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for non-admin users on retrain run creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/runs/retrain',
      payload: {
        windowDays: 90,
        minSamples: 100,
        trigger: 'MANUAL',
        activateIfPass: true,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      [NON_ADMIN_USER_ID],
    );
    expect(dbMocks.prisma.trainingRun.create).not.toHaveBeenCalled();
    expect(enqueueModelTrain).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin users on model activation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/models/model_1/activate',
      payload: {
        activatedByUserId: 'spoofed-user',
        retirePreviousActive: true,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(dbMocks.prisma.modelVersion.findUnique).not.toHaveBeenCalled();
    expect(dbMocks.prisma.modelVersion.updateMany).not.toHaveBeenCalled();
    expect(dbMocks.prisma.modelVersion.update).not.toHaveBeenCalled();
  });

  it('creates retrain runs under the authenticated admin', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/runs/retrain',
      payload: {
        windowDays: 90,
        minSamples: 100,
        trigger: 'MANUAL',
        activateIfPass: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      trainingRunId: 'training_run_1',
      status: 'QUEUED',
    });
    expect(dbMocks.prisma.trainingRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggeredByUserId: ADMIN_USER_ID,
        }),
      }),
    );
    expect(enqueueModelTrain).toHaveBeenCalledWith({
      runId: 'training_run_1',
      trainingRunId: 'training_run_1',
      trigger: 'MANUAL',
      windowDays: 90,
      minSamples: 100,
      activateIfPass: true,
      requestedByUserId: ADMIN_USER_ID,
    });
    expect(dbMocks.prisma.trainingRun.update).not.toHaveBeenCalled();
  });

  it('marks the created training run failed when manual retrain enqueue fails', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    enqueueModelTrain.mockRejectedValueOnce(new Error('pg-boss unavailable'));

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/runs/retrain',
      payload: {
        windowDays: 90,
        minSamples: 100,
        trigger: 'MANUAL',
        activateIfPass: true,
      },
    });

    expect(response.statusCode).toBe(500);
    expect(dbMocks.prisma.trainingRun.create).toHaveBeenCalledTimes(1);
    expect(enqueueModelTrain).toHaveBeenCalledTimes(1);
    expect(dbMocks.prisma.trainingRun.update).toHaveBeenCalledWith({
      where: { id: 'training_run_1' },
      data: {
        status: 'FAILED',
        endedAt: expect.any(Date),
        errorMessage: 'Failed to enqueue model.train job: pg-boss unavailable',
      },
    });

    const trainingRunCreateOrder = dbMocks.prisma.trainingRun.create.mock.invocationCallOrder[0];
    const enqueueOrder = enqueueModelTrain.mock.invocationCallOrder[0];
    const trainingRunFailOrder = dbMocks.prisma.trainingRun.update.mock.invocationCallOrder[0];
    expect(trainingRunCreateOrder).toBeDefined();
    expect(enqueueOrder).toBeDefined();
    expect(trainingRunFailOrder).toBeDefined();
    expect(trainingRunCreateOrder!).toBeLessThan(enqueueOrder!);
    expect(enqueueOrder!).toBeLessThan(trainingRunFailOrder!);
  });

  it('rejects public retrain run payloads that include requestedByUserId', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/runs/retrain',
      payload: {
        windowDays: 90,
        minSamples: 100,
        trigger: 'MANUAL',
        activateIfPass: true,
        requestedByUserId: 'spoofed-user',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Invalid retrain run payload',
      requestId: expect.any(String),
    });
    expect(dbMocks.prisma.trainingRun.create).not.toHaveBeenCalled();
    expect(enqueueModelTrain).not.toHaveBeenCalled();
  });

  it('activates a model by retiring other active versions for the same model type', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/models/model_1/activate',
      payload: {
        activatedByUserId: ADMIN_USER_ID,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'model_1',
      trainingRunId: 'training_run_1',
      modelType: 'LOGISTIC_REGRESSION',
      versionTag: 'v1',
      stage: 'ACTIVE',
      featureSchemaJson: {},
      coefficientsJson: {},
      intercept: null,
      deterministicWeightsJson: {},
      artifactUri: null,
      checksum: 'checksum',
      trainedAt: '2026-03-20T00:00:00.000Z',
      activatedAt: '2026-03-21T00:00:00.000Z',
      retiredAt: null,
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-21T00:00:00.000Z',
    });
    expect(dbMocks.prisma.modelVersion.updateMany).toHaveBeenCalledWith({
      where: {
        modelType: 'LOGISTIC_REGRESSION',
        stage: 'ACTIVE',
        id: { not: 'model_1' },
      },
      data: {
        stage: 'ARCHIVED',
        retiredAt: expect.any(Date),
      },
    });
    expect(dbMocks.prisma.modelVersion.update).toHaveBeenCalledWith({
      where: { id: 'model_1' },
      data: {
        stage: 'ACTIVE',
        activatedAt: expect.any(Date),
      },
    });

    const retireOrder = dbMocks.prisma.modelVersion.updateMany.mock.invocationCallOrder[0];
    const activateOrder = dbMocks.prisma.modelVersion.update.mock.invocationCallOrder[0];
    expect(retireOrder).toBeDefined();
    expect(activateOrder).toBeDefined();
    expect(retireOrder!).toBeLessThan(activateOrder!);
  });

  it('rejects model activation payloads that attempt to keep a prior active model', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning/models/model_1/activate',
      payload: {
        activatedByUserId: ADMIN_USER_ID,
        retirePreviousActive: false,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Invalid activate model payload',
      requestId: expect.any(String),
    });
    expect(dbMocks.prisma.modelVersion.findUnique).not.toHaveBeenCalled();
    expect(dbMocks.prisma.modelVersion.updateMany).not.toHaveBeenCalled();
    expect(dbMocks.prisma.modelVersion.update).not.toHaveBeenCalled();
  });
});
