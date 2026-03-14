import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    getPipelineSetting: vi.fn(),
    listPipelineSettings: vi.fn(),
    upsertPipelineSetting: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineSetting: prismaMock.getPipelineSetting,
  listPipelineSettings: prismaMock.listPipelineSettings,
  upsertPipelineSetting: prismaMock.upsertPipelineSetting,
}));

import { registerSettingsRoutes } from './settings.routes.js';

describe('settings.routes validation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    registerSettingsRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists pipeline settings via the shared db helper', async () => {
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
  });

  it('accepts auto_approve_score_max value 1.0 (inclusive upper bound)', async () => {
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
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/pipeline/auto_approve_score_max',
      payload: { value: '0.7' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: string };
    expect(body.error).toBe('auto_approve_score_max must be a number');
  });
});
