import { createLogger } from '@lead-flood/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type LoginRequest } from '@lead-flood/contracts';

import { buildServer, type BuildServerOptions } from './server.js';

// Mock dns for isEmailDeliverable tests
vi.mock('node:dns', () => ({
  promises: {
    resolveMx: vi.fn(async (domain: string) => {
      if (domain === 'mailinator.com' || domain === 'yopmail.com') {
        return [{ exchange: 'mx.mailinator.com', priority: 10 }];
      }
      if (domain === 'no-mx.invalid') {
        return [];
      }
      if (domain === 'dns-fail.invalid') {
        throw new Error('ENOTFOUND');
      }
      // Default: valid MX
      return [{ exchange: 'mx.example.com', priority: 10 }];
    }),
  },
}));
import type { ApiEnv } from './env.js';

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

const makeDefaultOptions = (): BuildServerOptions => ({
  env,
  logger: createLogger({ service: 'api-test', env: 'test', level: 'error' }),
  verifyAccessToken: async () => ({ sub: 'user_1', email: 'demo@lead-flood.local', firstName: 'Demo', lastName: 'User' }),
  checkDatabaseHealth: async () => true,
  authenticateUser: async ({ email }: LoginRequest) => ({
    tokenType: 'Bearer',
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresInSeconds: 3600,
    user: {
      id: 'user_1',
      email,
      firstName: 'Demo',
      lastName: 'User',
    },
  }),
  createLeadAndEnqueue: async () => ({ leadId: 'lead_1', jobId: 'job_1' }),
  getLeadById: async () => null,
  listLeads: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
  getJobById: async () => null,
});

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-token' };
}

describe('buildServer', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('returns health response', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 with typed error body', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/missing' });
    const body = response.json() as { error: string; requestId?: string };
    const requestIdHeader = response.headers['x-request-id'];

    expect(response.statusCode).toBe(404);
    expect(body.error).toBe('Route not found');
    expect(typeof body.requestId).toBe('string');
    expect(requestIdHeader).toBe(body.requestId);
  });

  it('returns 410 for deprecated auth login endpoint', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'demo@lead-flood.local',
        password: 'password',
      },
    });
    const body = response.json() as { error: string; requestId?: string };

    expect(response.statusCode).toBe(410);
    expect(body.error).toContain('Deprecated endpoint');
    expect(response.headers['x-request-id']).toBe(body.requestId);
  });

  it('creates lead and returns leadId/jobId', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: authHeaders(),
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        source: 'manual',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      leadId: 'lead_1',
      jobId: 'job_1',
    });
  });

  it('returns 400 for invalid lead payload', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: authHeaders(),
      payload: {
        firstName: 'Ada',
      },
    });
    const body = response.json() as { error: string };

    expect(response.statusCode).toBe(400);
    expect(body.error).toBe('Invalid lead payload');
  });

  it('returns 404 for missing lead', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads/lead_1',
      headers: authHeaders(),
    });
    const body = response.json() as { error: string };

    expect(response.statusCode).toBe(404);
    expect(body.error).toBe('Lead not found');
  });

  it('returns paginated lead inspection list', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads?page=1&pageSize=20',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });

  it('returns lead payload when found', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      getLeadById: async () => ({
        id: 'lead_1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: null,
        source: 'manual',
        status: 'enriched',
        enrichmentData: { company: 'Analytical Engines' },
        error: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads/lead_1',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'lead_1',
      status: 'enriched',
    });
  });

  it('returns 404 for missing job', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/jobs/job_1',
      headers: authHeaders(),
    });
    const body = response.json() as { error: string };

    expect(response.statusCode).toBe(404);
    expect(body.error).toBe('Job not found');
  });

  it('returns job payload when found', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const server = buildServer({
      ...makeDefaultOptions(),
      getJobById: async () => ({
        id: 'job_1',
        type: 'enrichment.run',
        status: 'completed',
        attempts: 1,
        leadId: 'lead_1',
        result: { status: 'ok' },
        error: null,
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        updatedAt: now,
      }),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/jobs/job_1',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'job_1',
      status: 'completed',
    });
  });

  it('returns 422 for disposable domain email', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: authHeaders(),
      payload: {
        firstName: 'Spam',
        lastName: 'Bot',
        email: 'test@mailinator.com',
        source: 'manual',
      },
    });

    const body = response.json() as { error: string };
    expect(response.statusCode).toBe(422);
    expect(body.error).toContain('DISPOSABLE_DOMAIN');
  });

  it('returns 422 for domain with no MX records', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: authHeaders(),
      payload: {
        firstName: 'No',
        lastName: 'MX',
        email: 'user@no-mx.invalid',
        source: 'manual',
      },
    });

    const body = response.json() as { error: string };
    expect(response.statusCode).toBe(422);
    expect(body.error).toContain('NO_MX_RECORDS');
  });

  it('returns 422 for domain with DNS lookup failure', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: authHeaders(),
      payload: {
        firstName: 'DNS',
        lastName: 'Fail',
        email: 'user@dns-fail.invalid',
        source: 'manual',
      },
    });

    const body = response.json() as { error: string };
    expect(response.statusCode).toBe(422);
    expect(body.error).toContain('DNS_LOOKUP_FAILED');
  });

  it('allows lead creation for valid domain with MX records', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads',
      headers: authHeaders(),
      payload: {
        firstName: 'Valid',
        lastName: 'User',
        email: 'valid@example.com',
        source: 'manual',
      },
    });

    expect(response.statusCode).toBe(201);
  });
});
