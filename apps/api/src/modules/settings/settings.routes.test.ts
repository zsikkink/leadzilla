import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    getPipelineSetting: vi.fn(),
    listPipelineSettings: vi.fn(),
    query: vi.fn(),
    upsertPipelineSetting: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineSetting: prismaMock.getPipelineSetting,
  listPipelineSettings: prismaMock.listPipelineSettings,
  query: prismaMock.query,
  upsertPipelineSetting: prismaMock.upsertPipelineSetting,
}));

import { registerSettingsRoutes } from './settings.routes.js';

describe('settings.routes validation', () => {
  const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
  const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

  let app: FastifyInstance;
  let currentUserId: string | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = NON_ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
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
    registerSettingsRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps pipeline settings reads shared for authenticated non-admin users', async () => {
    prismaMock.listPipelineSettings.mockResolvedValue([
      {
        key: 'auto_approve_enabled',
        valueJson: true,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/settings/pipeline',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          key: 'auto_approve_enabled',
          value: true,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(prismaMock.query).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin users on settings writes', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/auto_approve_score_max',
      payload: { value: 1.0 },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(prismaMock.upsertPipelineSetting).not.toHaveBeenCalled();
    expect(prismaMock.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      [NON_ADMIN_USER_ID],
    );
  });

  it('accepts auto_approve_score_max value 1.0 for app admins', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    prismaMock.getPipelineSetting.mockResolvedValue({ key: 'auto_approve_score_min', valueJson: 0 });
    prismaMock.upsertPipelineSetting.mockResolvedValue({
      key: 'auto_approve_score_max',
      valueJson: 1,
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/auto_approve_score_max',
      payload: { value: 1.0 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { key: string; value: number };
    expect(body.key).toBe('auto_approve_score_max');
    expect(body.value).toBe(1);
  });

  it('rejects auto_approve_score_max value 1.01', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/auto_approve_score_max',
      payload: { value: 1.01 },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe('auto_approve_score_max must be between 0 and 1 (inclusive)');
    expect(prismaMock.upsertPipelineSetting).not.toHaveBeenCalled();
  });

  it('returns key-specific error when score setting type is invalid', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/auto_approve_score_max',
      payload: { value: '0.7' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe('auto_approve_score_max must be a number');
  });

  it('rejects non-string messaging model values', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/messagingModel',
      payload: { value: { model: 'gpt-4.1-mini' } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe('messagingModel must be a string');
    expect(prismaMock.upsertPipelineSetting).not.toHaveBeenCalled();
  });

  it('rejects non-string scoring model values', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/scoringModel',
      payload: { value: { model: 'gpt-4.1-mini' } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe('scoringModel must be a string');
    expect(prismaMock.upsertPipelineSetting).not.toHaveBeenCalled();
  });

  it('rejects non-string scoring prompt values', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/scoringSystemPrompt',
      payload: { value: ['score enterprise fit'] },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe('scoringSystemPrompt must be a string');
    expect(prismaMock.upsertPipelineSetting).not.toHaveBeenCalled();
  });

  it('normalizes countryCities to SerpAPI discovery locations on write', async () => {
    currentUserId = ADMIN_USER_ID;
    prismaMock.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    prismaMock.upsertPipelineSetting.mockResolvedValue({
      key: 'countryCities',
      valueJson: {
        AE: ['Dubai', 'Abu Dhabi'],
      },
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/countryCities',
      payload: {
        value: {
          UAE: ['Dubai'],
          Egypt: ['not-serpapi-location'],
          Germany: ['Berlin'],
          AE: ['Abu Dhabi'],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.upsertPipelineSetting).toHaveBeenCalledWith(
      'countryCities',
      {
        AE: ['Dubai', 'Abu Dhabi'],
      },
    );
    expect(response.json()).toEqual({
      key: 'countryCities',
      value: {
        AE: ['Dubai', 'Abu Dhabi'],
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
