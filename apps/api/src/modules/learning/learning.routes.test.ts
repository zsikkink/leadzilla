import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      trainingRun: {
        create: vi.fn(),
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

    registerLearningRoutes(app);
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
  });
});
