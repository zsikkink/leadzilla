import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    getPipelineStatsSnapshot: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', () => ({
  getPipelineStatsSnapshot: prismaMock.getPipelineStatsSnapshot,
}));

import { registerStatsRoutes } from './stats.routes.js';

describe('stats.routes pipeline distribution', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    registerStatsRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('maps late-stage statuses into the correct distribution buckets', async () => {
    prismaMock.getPipelineStatsSnapshot.mockResolvedValue({
      leadDistribution: {
        discovered: 2,
        enriched: 3,
        scored: 23,
        messaged: 49,
      },
      pendingApprovals: 23,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/stats/pipeline',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      leadDistribution: {
        discovered: 2,
        enriched: 3,
        scored: 23,
        messaged: 49,
      },
      pendingApprovals: 23,
    });
  });
});
