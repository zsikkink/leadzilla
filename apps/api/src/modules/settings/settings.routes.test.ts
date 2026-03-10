import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    pipelineSetting: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  prisma: prismaMock,
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

  it('accepts auto_approve_score_max value 1.0 (inclusive upper bound)', async () => {
    prismaMock.pipelineSetting.findUnique.mockResolvedValue({ valueJson: 0 });
    prismaMock.pipelineSetting.upsert.mockResolvedValue({
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
    expect(prismaMock.pipelineSetting.upsert).not.toHaveBeenCalled();
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
