import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMocks, routeMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
  },
  routeMocks: {
    buildDiscoveryAdminService: vi.fn(),
    PrismaDiscoveryAdminRepository: vi.fn(() => ({})),
    service: {
      resolveApolloRevealAttempt: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  query: dbMocks.query,
}));

vi.mock('./discovery-admin.service.js', () => ({
  buildDiscoveryAdminService: routeMocks.buildDiscoveryAdminService,
}));

vi.mock('./discovery-admin.repository.js', () => ({
  PrismaDiscoveryAdminRepository: routeMocks.PrismaDiscoveryAdminRepository,
}));

import { registerDiscoveryAdminRoutes } from './discovery-admin.routes.js';

describe('discovery-admin.routes Apollo claim resolution', () => {
  let app: FastifyInstance;
  let currentUserId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = '11111111-1111-4111-8111-111111111111';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    routeMocks.buildDiscoveryAdminService.mockReturnValue(routeMocks.service as unknown);
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
    registerDiscoveryAdminRoutes(app, { adminApiKey: 'admin-key' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows authenticated admins to mark a claimed Apollo attempt abandoned', async () => {
    routeMocks.service.resolveApolloRevealAttempt.mockResolvedValue({
      id: 'attempt_1',
      status: 'ABANDONED',
      claimedAt: '2026-03-20T11:00:00.000Z',
      completedAt: null,
      resolvedAt: '2026-03-20T12:00:00.000Z',
      resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-03-20T12:00:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/apollo-reveal-attempts/attempt_1/resolve',
      headers: {
        'x-admin-key': 'admin-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      ['11111111-1111-4111-8111-111111111111'],
    );
    expect(routeMocks.service.resolveApolloRevealAttempt).toHaveBeenCalledWith(
      'attempt_1',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(response.json()).toEqual({
      id: 'attempt_1',
      status: 'ABANDONED',
      claimedAt: '2026-03-20T11:00:00.000Z',
      completedAt: null,
      resolvedAt: '2026-03-20T12:00:00.000Z',
      resolvedByUserId: '11111111-1111-4111-8111-111111111111',
      updatedAt: '2026-03-20T12:00:00.000Z',
    });
  });

  it('rejects Apollo claim resolution for authenticated non-admin users', async () => {
    currentUserId = '22222222-2222-4222-8222-222222222222';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/jobs/apollo-reveal-attempts/attempt_1/resolve',
      headers: {
        'x-admin-key': 'admin-key',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.resolveApolloRevealAttempt).not.toHaveBeenCalled();
  });
});
