import { createLogger } from '@lead-flood/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LeadFloodDbModule from '@lead-flood/db';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';

const { dbMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
  },
}));

vi.mock('@lead-flood/db', async () => {
  const actual = await vi.importActual<typeof LeadFloodDbModule>('@lead-flood/db');
  return {
    ...actual,
    query: dbMocks.query,
  };
});

import { prisma } from '@lead-flood/db';

import type { ApiEnv } from '../../src/env.js';
import { buildServer } from '../../src/server.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5434/lead_flood';
process.env.DATABASE_URL = databaseUrl;
const directUrl = process.env.DIRECT_URL ?? databaseUrl;
process.env.DIRECT_URL = directUrl;

const env: ApiEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  API_PORT: 5050,
  CORS_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'error',
  PG_BOSS_SCHEMA: 'pgboss',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl,
  APOLLO_API_KEY: 'apollo-test-key',
  PDL_API_KEY: 'pdl-test-key',
  DISCOVERY_ENABLED: true,
  ENRICHMENT_ENABLED: true,
};

function authHeaders(): Record<string, string> {
  return { authorization: 'Bearer test-token' };
}

describe('qualification rules integration', () => {
  const createdIcpIds: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
  });

  afterEach(async () => {
    if (createdIcpIds.length > 0) {
      const icpIds = createdIcpIds.splice(0, createdIcpIds.length);
      await prisma.qualificationRule.deleteMany({
        where: {
          icpProfileId: {
            in: icpIds,
          },
        },
      });
      await prisma.icpProfile.deleteMany({
        where: {
          id: {
            in: icpIds,
          },
        },
      });
    }
  });

  it('lists and replaces ICP qualification rules for admin tuning', async () => {
    const icp = await prisma.icpProfile.create({
      data: {
        name: `ICP Rules ${Date.now()}`,
        description: 'qualification rules test',
        qualificationLogic: 'WEIGHTED',
        metadataJson: {
          strategy: 'wide_net',
        },
        isActive: true,
      },
    });
    createdIcpIds.push(icp.id);

    await prisma.qualificationRule.create({
      data: {
        icpProfileId: icp.id,
        name: 'Country in region',
        ruleType: 'HARD_FILTER',
        isRequired: true,
        fieldKey: 'country',
        operator: 'IN',
        valueJson: ['UAE', 'KSA', 'Jordan', 'Egypt'],
        weight: null,
        orderIndex: 1,
        priority: 1,
      },
    });

    const server = buildServer({
      env,
      logger: createLogger({ service: 'api-test', env: 'test', level: 'error' }),
      verifyAccessToken: async () => ({ sub: ADMIN_USER_ID, email: null, firstName: null, lastName: null }),
      checkDatabaseHealth: async () => true,
      checkSchemaHealth: async () => ({ status: 'ok', missingTables: [], missingEnumValues: [] }),
      authenticateUser: async () => null,
      createLeadAndEnqueue: async () => ({ leadId: 'lead_1', jobId: 'job_1' }),
      getLeadById: async () => null,
      listLeads: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      listContactRecoveryItems: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      getContactRecoveryItem: async () => null,
      rejectContactRecoveryItem: async () => null,
      getJobById: async () => null,
    });

    const listResponse = await server.inject({
      method: 'GET',
      url: '/v1/icps?page=1&pageSize=20',
      headers: authHeaders(),
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = listResponse.json() as {
      items: Array<{ id: string }>;
    };
    expect(listBody.items.some((item) => item.id === icp.id)).toBe(true);

    const getResponse = await server.inject({
      method: 'GET',
      url: `/v1/icps/${icp.id}`,
      headers: authHeaders(),
    });
    expect(getResponse.statusCode).toBe(200);

    const rulesResponse = await server.inject({
      method: 'GET',
      url: `/v1/icps/${icp.id}/rules`,
      headers: authHeaders(),
    });
    expect(rulesResponse.statusCode).toBe(200);
    const rulesBody = rulesResponse.json() as {
      items: Array<{ fieldKey: string; isRequired: boolean }>;
    };
    expect(rulesBody.items).toHaveLength(1);
    expect(rulesBody.items[0]).toMatchObject({
      fieldKey: 'country',
      isRequired: true,
    });

    const replaceResponse = await server.inject({
      method: 'PUT',
      url: `/v1/icps/${icp.id}/rules`,
      headers: authHeaders(),
      payload: {
        rules: [
          {
            name: 'Country in region',
            fieldKey: 'country',
            operator: 'IN',
            valueJson: ['UAE', 'KSA', 'Jordan', 'Egypt'],
            isRequired: true,
            weight: 0,
            orderIndex: 1,
          },
          {
            name: 'Accepts online payments',
            fieldKey: 'accepts_online_payments',
            operator: 'EQ',
            valueJson: true,
            isRequired: false,
            weight: 2,
            orderIndex: 2,
          },
          {
            name: 'Pure self serve anti-fit',
            fieldKey: 'pure_self_serve_ecom',
            operator: 'EQ',
            valueJson: true,
            isRequired: false,
            weight: -3,
            orderIndex: 3,
          },
        ],
      },
    });
    expect(replaceResponse.statusCode).toBe(200);
    const replaceBody = replaceResponse.json() as {
      items: Array<{ fieldKey: string; isRequired: boolean; weight: number | null }>;
    };
    expect(replaceBody.items).toHaveLength(3);
    expect(replaceBody.items.find((item) => item.fieldKey === 'country')?.isRequired).toBe(true);
    expect(replaceBody.items.find((item) => item.fieldKey === 'pure_self_serve_ecom')?.weight).toBe(
      -3,
    );

    await server.close();
  });

  it('creates and updates ICP profiles with feature lists for authenticated app admins', async () => {
    const server = buildServer({
      env,
      logger: createLogger({ service: 'api-test', env: 'test', level: 'error' }),
      verifyAccessToken: async () => ({ sub: ADMIN_USER_ID, email: null, firstName: null, lastName: null }),
      checkDatabaseHealth: async () => true,
      checkSchemaHealth: async () => ({ status: 'ok', missingTables: [], missingEnumValues: [] }),
      authenticateUser: async () => null,
      createLeadAndEnqueue: async () => ({ leadId: 'lead_1', jobId: 'job_1' }),
      getLeadById: async () => null,
      listLeads: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      listContactRecoveryItems: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      getContactRecoveryItem: async () => null,
      rejectContactRecoveryItem: async () => null,
      getJobById: async () => null,
    });

    const createResponse = await server.inject({
      method: 'POST',
      url: '/v1/icps',
      headers: authHeaders(),
      payload: {
        name: `JWT ICP ${Date.now()}`,
        description: 'jwt create test',
        targetIndustries: ['SaaS'],
        targetCountries: ['UAE'],
        featureList: ['Search by category', 'Pitch feature A'],
        isActive: true,
      },
    });

    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as {
      id: string;
      featureList: string[] | null;
    };
    createdIcpIds.push(created.id);
    expect(created.featureList).toEqual(['Search by category', 'Pitch feature A']);

    const updateResponse = await server.inject({
      method: 'PATCH',
      url: `/v1/icps/${created.id}`,
      headers: authHeaders(),
      payload: {
        featureList: ['Updated feature'],
        requiredTechnologies: ['HubSpot'],
      },
    });

    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json() as {
      featureList: string[] | null;
      requiredTechnologies: string[];
    };
    expect(updated.featureList).toEqual(['Updated feature']);
    expect(updated.requiredTechnologies).toEqual(['HubSpot']);

    const replaceRulesResponse = await server.inject({
      method: 'PUT',
      url: `/v1/icps/${created.id}/rules`,
      headers: authHeaders(),
      payload: {
        rules: [
          {
            name: 'Country in region',
            fieldKey: 'country',
            operator: 'IN',
            valueJson: ['UAE'],
            isRequired: true,
            weight: 0,
            orderIndex: 1,
          },
        ],
      },
    });

    expect(replaceRulesResponse.statusCode).toBe(200);

    await server.close();
  });
});
