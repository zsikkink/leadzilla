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
      listStaleMessageSends: vi.fn(),
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

describe('discovery-admin.routes stale message sends', () => {
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

  it('returns stale SENDING message sends for authenticated admins', async () => {
    routeMocks.service.listStaleMessageSends.mockResolvedValue({
      items: [
        {
          id: 'send_1',
          leadId: 'lead_1',
          leadEmail: 'ava@example.com',
          leadFirstName: 'Ava',
          leadLastName: 'Jones',
          businessName: 'Alpha Co',
          messageDraftId: 'draft_1',
          messageVariantId: 'variant_1',
          channel: 'WHATSAPP',
          provider: 'TRENGO',
          status: 'SENDING',
          idempotencyKey: 'approve:draft_1:variant_1',
          providerMessageId: null,
          providerConversationId: 'ticket_42',
          scheduledAt: null,
          sentAt: null,
          followUpNumber: 0,
          createdAt: '2026-03-21T01:00:00.000Z',
          updatedAt: '2026-03-21T01:15:00.000Z',
          sendingAgeMinutes: 45,
        },
      ],
      page: 2,
      pageSize: 10,
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/message-sends/stale?page=2&pageSize=10&olderThanMinutes=45',
      headers: {
        'x-admin-key': 'admin-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      ['11111111-1111-4111-8111-111111111111'],
    );
    expect(routeMocks.service.listStaleMessageSends).toHaveBeenCalledWith({
      page: 2,
      pageSize: 10,
      olderThanMinutes: 45,
    });
    expect(response.json()).toEqual({
      items: [
        {
          id: 'send_1',
          leadId: 'lead_1',
          leadEmail: 'ava@example.com',
          leadFirstName: 'Ava',
          leadLastName: 'Jones',
          businessName: 'Alpha Co',
          messageDraftId: 'draft_1',
          messageVariantId: 'variant_1',
          channel: 'WHATSAPP',
          provider: 'TRENGO',
          status: 'SENDING',
          idempotencyKey: 'approve:draft_1:variant_1',
          providerMessageId: null,
          providerConversationId: 'ticket_42',
          scheduledAt: null,
          sentAt: null,
          followUpNumber: 0,
          createdAt: '2026-03-21T01:00:00.000Z',
          updatedAt: '2026-03-21T01:15:00.000Z',
          sendingAgeMinutes: 45,
        },
      ],
      page: 2,
      pageSize: 10,
      total: 1,
    });
  });

  it('rejects stale message-send visibility for authenticated non-admin users', async () => {
    currentUserId = '22222222-2222-4222-8222-222222222222';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/message-sends/stale?page=1&pageSize=20',
      headers: {
        'x-admin-key': 'admin-key',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.listStaleMessageSends).not.toHaveBeenCalled();
  });
});
