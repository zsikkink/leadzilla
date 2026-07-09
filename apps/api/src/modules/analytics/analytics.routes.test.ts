import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

const { dbMocks, routeMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
  },
  routeMocks: {
    buildAnalyticsService: vi.fn(),
    HybridAnalyticsRepository: vi.fn(() => ({})),
    service: {
      getFunnel: vi.fn(),
      recomputeRollup: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  query: dbMocks.query,
}));

vi.mock('./analytics.service.js', () => ({
  buildAnalyticsService: routeMocks.buildAnalyticsService,
}));

vi.mock('./analytics.repository.js', () => ({
  HybridAnalyticsRepository: routeMocks.HybridAnalyticsRepository,
}));

import { registerAnalyticsRoutes } from './analytics.routes.js';

describe('analytics.routes authz', () => {
  let app: FastifyInstance;
  let currentUserId: string | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = NON_ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });
    routeMocks.buildAnalyticsService.mockReturnValue(routeMocks.service as unknown);
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
    registerAnalyticsRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for non-admin users on rollup recompute', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/analytics/rollups/recompute',
      payload: {
        day: '2026-03-20',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.recomputeRollup).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      [NON_ADMIN_USER_ID],
    );
  });

  it('allows app admins to recompute rollups without x-admin-key', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    routeMocks.service.recomputeRollup.mockResolvedValue(undefined);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/analytics/rollups/recompute',
      payload: {
        day: '2026-03-20',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(routeMocks.service.recomputeRollup).toHaveBeenCalledWith({
      day: '2026-03-20',
      fullRecompute: false,
    });
  });

  it('keeps analytics reads shared for authenticated non-admin users', async () => {
    routeMocks.service.getFunnel.mockResolvedValue({
      from: null,
      to: null,
      icpProfileId: null,
      businessCount: 12,
      discoveredCount: 10,
      qualifiedCount: 4,
      enrichedCount: 5,
      scoredCount: 4,
      messagesGeneratedCount: 3,
      messagesSentCount: 2,
      repliesCount: 1,
      meetingsCount: 0,
      dealsWonCount: 0,
      totalCostCents: 1200,
      costPerLead: 120,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/analytics/funnel',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      from: null,
      to: null,
      icpProfileId: null,
      businessCount: 12,
      discoveredCount: 10,
      qualifiedCount: 4,
      enrichedCount: 5,
      scoredCount: 4,
      messagesGeneratedCount: 3,
      messagesSentCount: 2,
      repliesCount: 1,
      meetingsCount: 0,
      dealsWonCount: 0,
      totalCostCents: 1200,
      costPerLead: 120,
    });
    expect(dbMocks.query).not.toHaveBeenCalled();
  });
});
