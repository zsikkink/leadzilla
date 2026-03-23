import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

const { dbMocks, routeMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
  },
  routeMocks: {
    buildIcpService: vi.fn(),
    PrismaIcpRepository: vi.fn(() => ({})),
    service: {
      createIcpProfile: vi.fn(),
      listIcpProfiles: vi.fn(),
      getIcpProfile: vi.fn(),
      updateIcpProfile: vi.fn(),
      deleteIcpProfile: vi.fn(),
      createQualificationRule: vi.fn(),
      updateQualificationRule: vi.fn(),
      deleteQualificationRule: vi.fn(),
      listIcpRules: vi.fn(),
      replaceIcpRules: vi.fn(),
      getIcpStatus: vi.fn(),
      getIcpDebugSample: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  query: dbMocks.query,
}));

vi.mock('./icp.service.js', () => ({
  buildIcpService: routeMocks.buildIcpService,
}));

vi.mock('./icp.repository.js', () => ({
  PrismaIcpRepository: routeMocks.PrismaIcpRepository,
}));

import { registerIcpRoutes } from './icp.routes.js';

function buildIcpProfileResponse() {
  return {
    id: 'icp_1',
    name: 'ICP 1',
    description: null,
    qualificationLogic: 'WEIGHTED' as const,
    metadataJson: null,
    targetIndustries: [],
    targetCountries: [],
    minCompanySize: null,
    maxCompanySize: null,
    requiredTechnologies: [],
    excludedDomains: [],
    featureList: null,
    isActive: true,
    createdByUserId: null,
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
  };
}

function buildIcpDebugSampleResponse() {
  return {
    icpProfileId: 'icp_1',
    providerQueries: [
      {
        provider: 'BRAVE_SEARCH' as const,
        query: { q: 'dental clinic dubai' },
      },
    ],
    samples: [
      {
        leadId: 'lead_1',
        discoveryRecordId: 'discovery_1',
        provider: 'BRAVE_SEARCH' as const,
        rawPayload: { source: 'test' },
        normalizedPayload: {
          email: 'lead@example.com',
          domain: 'example.com',
          companyName: 'Example Co',
          industry: 'Dental',
          employeeCount: 15,
          country: 'AE',
          city: 'Dubai',
          linkedinUrl: null,
          website: 'https://example.com',
        },
        ruleEvaluations: [
          {
            ruleId: 'rule_1',
            fieldKey: 'country',
            operator: 'EQ' as const,
            matched: true,
          },
        ],
      },
    ],
  };
}

describe('icp.routes authz', () => {
  let app: FastifyInstance;
  let currentUserId: string | null;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = NON_ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });
    routeMocks.buildIcpService.mockReturnValue(routeMocks.service as unknown);
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
    registerIcpRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 403 for non-admin users on ICP mutations', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/icps',
      payload: {
        name: 'New ICP',
        isActive: true,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.createIcpProfile).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      [NON_ADMIN_USER_ID],
    );
  });

  it('allows app admins to create ICPs over JWT auth only', async () => {
    currentUserId = ADMIN_USER_ID;
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    routeMocks.service.createIcpProfile.mockResolvedValue(buildIcpProfileResponse());

    const response = await app.inject({
      method: 'POST',
      url: '/v1/icps',
      payload: {
        name: 'New ICP',
        isActive: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'icp_1',
      name: 'ICP 1',
    });
    expect(routeMocks.service.createIcpProfile).toHaveBeenCalledWith({
      name: 'New ICP',
      isActive: true,
    });
  });

  it('keeps ICP list reads shared for authenticated non-admin users', async () => {
    routeMocks.service.listIcpProfiles.mockResolvedValue({
      items: [buildIcpProfileResponse()],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/icps?page=1&pageSize=20',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [expect.objectContaining({ id: 'icp_1' })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(routeMocks.service.listIcpProfiles).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
    });
    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin users on the ICP debug sample route', async () => {
    routeMocks.service.getIcpDebugSample.mockResolvedValue(buildIcpDebugSampleResponse());

    const response = await app.inject({
      method: 'GET',
      url: '/v1/icp/icp_1/debug-sample?limit=5',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.getIcpDebugSample).not.toHaveBeenCalled();
  });
});
