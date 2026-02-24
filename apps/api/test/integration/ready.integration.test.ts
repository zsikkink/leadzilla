import { createLogger } from '@lead-flood/observability';
import { describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.js';
import type { ApiEnv } from '../../src/env.js';

const env: ApiEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  API_PORT: 5050,
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'error',
  PG_BOSS_SCHEMA: 'pgboss',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
  DIRECT_URL: 'postgresql://postgres:postgres@localhost:5434/lead_flood',
  APOLLO_API_KEY: 'apollo-test-key',
  PDL_API_KEY: 'pdl-test-key',
  DISCOVERY_ENABLED: true,
  ENRICHMENT_ENABLED: true,
};

describe('GET /ready', () => {
  it('returns 503 when db check fails', async () => {
    const server = buildServer({
      env,
      logger: createLogger({ service: 'api-test', env: 'test', level: 'error' }),
      verifyAccessToken: async () => ({ sub: 'user_1', email: null, firstName: null, lastName: null }),
      checkDatabaseHealth: async () => false,
      authenticateUser: async () => null,
      createLeadAndEnqueue: async () => ({ leadId: 'lead_1', jobId: 'job_1' }),
      getLeadById: async () => null,
      listLeads: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      getJobById: async () => null,
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready', db: 'fail' });
    await server.close();
  });

  it('returns 200 when db check succeeds', async () => {
    const server = buildServer({
      env,
      logger: createLogger({ service: 'api-test', env: 'test', level: 'error' }),
      verifyAccessToken: async () => ({ sub: 'user_1', email: null, firstName: null, lastName: null }),
      checkDatabaseHealth: async () => true,
      authenticateUser: async () => null,
      createLeadAndEnqueue: async () => ({ leadId: 'lead_1', jobId: 'job_1' }),
      getLeadById: async () => null,
      listLeads: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      getJobById: async () => null,
    });

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready', db: 'ok' });
    await server.close();
  });
});
