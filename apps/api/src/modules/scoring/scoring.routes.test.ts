import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
    prisma: {
      $transaction: vi.fn(),
      jobExecution: {
        create: vi.fn(),
      },
      outboxEvent: {
        create: vi.fn(),
      },
      qualificationRule: {
        aggregate: vi.fn(),
        create: vi.fn(),
      },
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: dbMocks.prisma,
  query: dbMocks.query,
  toInputJson: <T>(value: T) => value,
}));

import { registerScoringRoutes } from './scoring.routes.js';

describe('scoring.routes authz', () => {
  let app: FastifyInstance;
  let currentUserId: string | null;
  let enqueueScoringRun: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = NON_ADMIN_USER_ID;
    enqueueScoringRun = vi.fn(async () => undefined);

    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });
    dbMocks.prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof dbMocks.prisma) => Promise<unknown>) => callback(dbMocks.prisma),
    );
    dbMocks.prisma.jobExecution.create.mockResolvedValue(undefined);
    dbMocks.prisma.outboxEvent.create.mockResolvedValue({ id: 'outbox_1' });
    dbMocks.prisma.qualificationRule.aggregate.mockResolvedValue({
      _max: { orderIndex: 0 },
    });
    dbMocks.prisma.qualificationRule.create.mockResolvedValue({
      id: 'rule_1',
      icpProfileId: 'icp_1',
      name: 'Industry supported',
      ruleType: 'WEIGHTED',
      fieldKey: 'industry_supported',
      operator: 'EQ',
      valueJson: true,
      weight: 1,
      isRequired: false,
      priority: 1,
      orderIndex: 1,
      isActive: true,
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      updatedAt: new Date('2026-03-20T00:00:00.000Z'),
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

    registerScoringRoutes(app, { enqueueScoringRun });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for non-admin users on scoring run creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/scoring/runs',
      payload: {
        mode: 'ALL_ACTIVE_ICPS',
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
    expect(dbMocks.prisma.jobExecution.create).not.toHaveBeenCalled();
    expect(dbMocks.prisma.outboxEvent.create).not.toHaveBeenCalled();
    expect(enqueueScoringRun).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin users on qualification rule creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/scoring/rules',
      payload: {
        icpProfileId: 'icp_1',
        fieldKey: 'industry_supported',
        operator: 'EQ',
        valueJson: true,
        weight: 1,
        ruleType: 'WEIGHTED',
        name: 'Industry supported',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(dbMocks.prisma.qualificationRule.aggregate).not.toHaveBeenCalled();
    expect(dbMocks.prisma.qualificationRule.create).not.toHaveBeenCalled();
  });

  it('creates scoring runs under the authenticated admin', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/scoring/runs',
      payload: {
        mode: 'ALL_ACTIVE_ICPS',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      runId: expect.any(String),
      status: 'QUEUED',
    });
    expect(dbMocks.prisma.jobExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            requestedByUserId: ADMIN_USER_ID,
          }),
        }),
      }),
    );
    expect(dbMocks.prisma.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            requestedByUserId: ADMIN_USER_ID,
          }),
        }),
      }),
    );
    expect(enqueueScoringRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedByUserId: ADMIN_USER_ID,
      }),
    );
  });

  it('rejects public scoring run payloads that include requestedByUserId', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/scoring/runs',
      payload: {
        mode: 'ALL_ACTIVE_ICPS',
        requestedByUserId: 'spoofed-user',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Invalid scoring run payload',
      requestId: expect.any(String),
    });
    expect(dbMocks.prisma.jobExecution.create).not.toHaveBeenCalled();
    expect(dbMocks.prisma.outboxEvent.create).not.toHaveBeenCalled();
    expect(enqueueScoringRun).not.toHaveBeenCalled();
  });
});
