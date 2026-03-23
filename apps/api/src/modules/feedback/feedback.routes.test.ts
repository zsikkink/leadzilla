import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

const { dbMocks, routeMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
  },
  routeMocks: {
    buildFeedbackService: vi.fn(),
    PrismaFeedbackRepository: vi.fn(() => ({})),
    service: {
      ingestFeedbackEvent: vi.fn(),
      listFeedbackEvents: vi.fn(),
      getFeedbackSummary: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  query: dbMocks.query,
}));

vi.mock('./feedback.service.js', () => ({
  buildFeedbackService: routeMocks.buildFeedbackService,
}));

vi.mock('./feedback.repository.js', () => ({
  PrismaFeedbackRepository: routeMocks.PrismaFeedbackRepository,
}));

import { registerFeedbackRoutes } from './feedback.routes.js';

describe('feedback.routes authz', () => {
  let app: FastifyInstance;
  let currentUserId: string | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = NON_ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });
    routeMocks.buildFeedbackService.mockReturnValue(routeMocks.service as unknown);
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
    registerFeedbackRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for non-admin users on manual feedback ingest', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback/events',
      payload: {
        leadId: 'lead_1',
        eventType: 'REPLIED',
        source: 'MANUAL',
        occurredAt: '2026-03-20T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.ingestFeedbackEvent).not.toHaveBeenCalled();
  });

  it('allows app admins to ingest feedback events', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    routeMocks.service.ingestFeedbackEvent.mockResolvedValue({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'dedupe_1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback/events',
      payload: {
        leadId: 'lead_1',
        eventType: 'REPLIED',
        source: 'MANUAL',
        occurredAt: '2026-03-20T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      feedbackEventId: 'feedback_1',
      dedupeKey: 'dedupe_1',
    });
    expect(routeMocks.service.ingestFeedbackEvent).toHaveBeenCalledWith({
      leadId: 'lead_1',
      eventType: 'REPLIED',
      source: 'MANUAL',
      occurredAt: '2026-03-20T00:00:00.000Z',
    });
  });

  it('keeps feedback reads shared for authenticated non-admin users', async () => {
    routeMocks.service.listFeedbackEvents.mockResolvedValue({
      items: [
        {
          id: 'feedback_1',
          leadId: 'lead_1',
          messageSendId: null,
          eventType: 'REPLIED',
          source: 'MANUAL',
          providerEventId: null,
          dedupeKey: 'dedupe_1',
          payloadJson: null,
          replyText: null,
          replyClassification: null,
          occurredAt: '2026-03-20T00:00:00.000Z',
          createdAt: '2026-03-20T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/feedback/events?page=1&pageSize=20',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'feedback_1' })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(routeMocks.service.listFeedbackEvents).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    });
    expect(dbMocks.query).not.toHaveBeenCalled();
  });
});
