import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRawUnsafe: vi.fn(),
    jobExecution: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    business: {
      findMany: vi.fn(),
    },
    discoveryCostEvent: {
      findMany: vi.fn(),
    },
    searchTask: {
      findMany: vi.fn(),
    },
    businessConversion: {
      findMany: vi.fn(),
    },
    contactRecoveryItem: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
  toInputJson: <T>(value: T) => value,
}));

import { registerDiscoveryRoutes } from './discovery.routes.js';

function buildDiscoveryRun(overrides?: {
  id?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  requestedByUserId?: string;
  result?: Record<string, unknown>;
}): {
  id: string;
  type: 'discovery.run';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
} {
  return {
    id: overrides?.id ?? 'run_own',
    type: 'discovery.run',
    status: overrides?.status ?? 'running',
    payload: {
      requestedByUserId: overrides?.requestedByUserId ?? 'user_a',
      icpProfileId: 'icp_1',
      countries: ['AE'],
      limit: 10,
    },
    result: overrides?.result ?? {
      totalItems: 4,
      processedItems: 2,
      failedItems: 0,
      searchTasksComplete: false,
    },
    error: null,
    createdAt: new Date('2026-03-18T12:00:00.000Z'),
    startedAt: new Date('2026-03-18T12:01:00.000Z'),
    finishedAt: null,
    updatedAt: new Date('2026-03-18T12:02:00.000Z'),
  };
}

describe('discovery.routes ownership scoping', () => {
  let app: FastifyInstance;
  let currentUserId = 'user_a';
  let enqueueDiscoveryRun: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = 'user_a';
    enqueueDiscoveryRun = vi.fn(async () => undefined);

    prismaMock.$queryRawUnsafe.mockResolvedValue([{ active: true }]);
    prismaMock.jobExecution.count.mockResolvedValue(0);
    prismaMock.jobExecution.create.mockResolvedValue(undefined);

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      request.user = {
        sub: currentUserId,
        email: null,
        firstName: null,
        lastName: null,
      };
    });

    registerDiscoveryRoutes(app, {
      enqueueDiscoveryRun,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists only runs owned by the authenticated user', async () => {
    const ownRun = buildDiscoveryRun({ id: 'run_own', requestedByUserId: 'user_a' });
    const otherRun = buildDiscoveryRun({ id: 'run_other', requestedByUserId: 'user_b' });

    prismaMock.jobExecution.count.mockImplementation(async (args: { where: { payload?: { equals?: string } } }) =>
      args.where.payload?.equals === 'user_a' ? 1 : 2,
    );
    prismaMock.jobExecution.findMany.mockImplementation(async (args: { where: { payload?: { equals?: string } } }) =>
      args.where.payload?.equals === 'user_a' ? [ownRun] : [otherRun],
    );

    const response = await app.inject({
      method: 'GET',
      url: '/v1/discovery/runs?page=1&pageSize=20',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runs: [
        {
          runId: 'run_own',
          status: 'RUNNING',
          totalItems: 4,
          processedItems: 2,
          failedItems: 0,
          createdAt: '2026-03-18T12:00:00.000Z',
          startedAt: '2026-03-18T12:01:00.000Z',
          finishedAt: null,
          icpProfileId: 'icp_1',
          icpProfileIds: ['icp_1'],
          countries: ['AE'],
          limit: 10,
          errorMessage: null,
          currentStage: 'searching',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(prismaMock.jobExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'discovery.run',
          payload: {
            path: ['requestedByUserId'],
            equals: 'user_a',
          },
        }),
      }),
    );
  });

  it('returns not found when the authenticated user requests another user’s run status', async () => {
    prismaMock.jobExecution.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/discovery/runs/run_other',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'Discovery run not found',
      requestId: expect.any(String),
    });
    expect(prismaMock.jobExecution.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'run_other',
        type: 'discovery.run',
        payload: {
          path: ['requestedByUserId'],
          equals: 'user_a',
        },
      },
    });
  });

  it('returns not found when the authenticated user requests another user’s run details', async () => {
    prismaMock.jobExecution.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/discovery/runs/run_other/details',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'Discovery run not found',
      requestId: expect.any(String),
    });
    expect(prismaMock.jobExecution.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'run_other',
        type: 'discovery.run',
        payload: {
          path: ['requestedByUserId'],
          equals: 'user_a',
        },
      },
    });
    expect(prismaMock.business.findMany).not.toHaveBeenCalled();
    expect(prismaMock.discoveryCostEvent.findMany).not.toHaveBeenCalled();
    expect(prismaMock.searchTask.findMany).not.toHaveBeenCalled();
  });

  it('still returns the authenticated user’s own runs normally', async () => {
    const ownRun = buildDiscoveryRun({ id: 'run_own', requestedByUserId: 'user_a' });

    prismaMock.jobExecution.count.mockResolvedValue(1);
    prismaMock.jobExecution.findMany.mockResolvedValue([ownRun]);
    prismaMock.jobExecution.findFirst.mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === 'run_own' ? ownRun : null,
    );
    prismaMock.business.findMany.mockResolvedValue([]);
    prismaMock.discoveryCostEvent.findMany.mockResolvedValue([]);
    prismaMock.searchTask.findMany.mockResolvedValue([]);

    const [listResponse, statusResponse, detailsResponse] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/v1/discovery/runs?page=1&pageSize=20',
      }),
      app.inject({
        method: 'GET',
        url: '/v1/discovery/runs/run_own',
      }),
      app.inject({
        method: 'GET',
        url: '/v1/discovery/runs/run_own/details',
      }),
    ]);

    expect(listResponse.statusCode).toBe(200);
    expect((listResponse.json() as { runs: Array<{ runId: string }> }).runs).toEqual([
      expect.objectContaining({ runId: 'run_own' }),
    ]);

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toEqual({
      runId: 'run_own',
      runType: 'DISCOVERY',
      status: 'RUNNING',
      totalItems: 4,
      processedItems: 2,
      failedItems: 0,
      startedAt: '2026-03-18T12:01:00.000Z',
      endedAt: null,
      errorMessage: null,
      createdAt: '2026-03-18T12:00:00.000Z',
      updatedAt: '2026-03-18T12:02:00.000Z',
      currentStage: 'searching',
    });

    expect(detailsResponse.statusCode).toBe(200);
    expect(detailsResponse.json()).toEqual({
      run: {
        id: 'run_own',
        status: 'running',
        icpProfileId: 'icp_1',
        config: ownRun.payload,
        tasksTotal: 4,
        tasksCompleted: 2,
        tasksFailed: 0,
        businessesFound: 0,
        leadsConverted: 0,
        totalFound: 0,
        alreadyKnown: null,
        newFound: null,
        disqualified: null,
        converted: 0,
        queryExperiment: {
          bestFamily: null,
          families: [],
        },
        createdAt: '2026-03-18T12:00:00.000Z',
        errorMessage: null,
        outcome: null,
      },
      searchTasks: [],
      businesses: [],
      leads: [],
      costEvents: [],
    });
  });

  it('creates discovery runs under the authenticated user even when the client supplies requestedByUserId', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/discovery/runs',
      payload: {
        icpProfileId: 'icp_1',
        countries: ['AE'],
        limit: 10,
        requestedByUserId: 'user_b',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId: expect.any(String),
      status: 'QUEUED',
    });

    expect(prismaMock.jobExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            requestedByUserId: 'user_a',
            icpProfileIds: ['icp_1'],
          }),
        }),
      }),
    );

    expect(enqueueDiscoveryRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedByUserId: 'user_a',
      }),
    );
  });
});
