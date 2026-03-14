import { createLogger } from '@lead-flood/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoginRequest } from '@lead-flood/contracts';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    getScoreQualificationThresholdSetting: vi.fn(),
    prisma: {
      lead: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      leadScorePrediction: {
        findFirst: vi.fn(),
      },
      leadRejection: {
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
    Prisma: {
      JsonNull: null,
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  getScoreQualificationThresholdSetting: dbMock.getScoreQualificationThresholdSetting,
  prisma: dbMock.prisma,
  Prisma: dbMock.Prisma,
}));

import type { ApiEnv } from './env.js';
import { buildServer, type BuildServerOptions } from './server.js';

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
  checkSchemaHealth: async () => ({ status: 'ok', missingTables: [], missingEnumValues: [] }),
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
  listContactRecoveryItems: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
  getContactRecoveryItem: async () => null,
  rejectContactRecoveryItem: async () => null,
  getJobById: async () => null,
});

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-token' };
}

describe('buildServer unreject route', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.prisma.lead.findFirst.mockResolvedValue({ id: 'lead_1', status: 'rejected' });
    dbMock.prisma.leadScorePrediction.findFirst.mockResolvedValue({ blendedScore: 0.62 });
    dbMock.prisma.leadRejection.deleteMany.mockResolvedValue({ count: 1 });
    dbMock.prisma.lead.update.mockResolvedValue({});
    dbMock.prisma.$transaction.mockResolvedValue([]);
  });

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers.length = 0;
  });

  it('uses the shared threshold helper to restore a qualified lead', async () => {
    dbMock.getScoreQualificationThresholdSetting.mockResolvedValue(0.5);
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/leads/lead_1/unreject',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(204);
    expect(dbMock.getScoreQualificationThresholdSetting).toHaveBeenCalledWith(0.5);
    expect(dbMock.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead_1' },
      data: { status: 'qualified' },
    });
  });

  it('restores scored when the shared threshold helper returns a higher threshold', async () => {
    dbMock.getScoreQualificationThresholdSetting.mockResolvedValue(0.7);
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/leads/lead_1/unreject',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(204);
    expect(dbMock.prisma.lead.update).toHaveBeenCalledWith({
      where: { id: 'lead_1' },
      data: { status: 'scored' },
    });
  });
});
