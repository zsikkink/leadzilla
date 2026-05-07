import { createLogger } from '@lead-flood/observability';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LeadFloodDbModule from '@lead-flood/db';

import { type LoginRequest } from '@lead-flood/contracts';

const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const NON_ADMIN_USER_ID = '22222222-2222-4222-8222-222222222222';

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

import { LeadContextUnavailableError, buildServer, type BuildServerOptions } from './server.js';

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

function buildContactRecoveryItem(reason: 'NO_CONTACTS_FOUND' | 'NO_EMAIL' | 'DECISION_MAKER_IDENTIFIED') {
  return {
    id: 'recovery_1',
    businessId: 'business_1',
    icpProfileId: 'icp_1',
    icpProfileName: 'Clinics',
    discoveryRunId: 'run_1',
    status: 'OPEN' as const,
    reason,
    evidenceScore: 0.72,
    candidateCount: 2,
    rejectedBy: null,
    rejectedAt: null,
    createdAt: '2026-03-08T00:00:00.000Z',
    updatedAt: '2026-03-08T00:00:00.000Z',
    business: {
      id: 'business_1',
      name: 'Atlas Clinic',
      city: 'Amman',
      country: 'Jordan',
      countryCode: 'JO',
      websiteDomain: 'atlas.example',
      instagramHandle: 'atlas',
      category: 'Dental Clinic',
      deterministicScore: 0.81,
      scoreBand: 'HIGH' as const,
      preQualified: false,
      disqualificationReason: reason,
    },
    snapshot: {
      businessId: 'business_1',
      domain: 'atlas.example',
      locality: 'Amman, JO',
      generatedAt: '2026-03-08T00:00:00.000Z',
      businessInsights: null,
      genericBusinessEmail: null,
      telemetry: {
        cseVerifyAttempted: true,
        cseVerifySucceeded: true,
        cseDiscoverAttempted: true,
        cseDiscoverSucceeded: false,
        cseRawResults: 4,
        cseValidProfiles: 2,
        cseCandidatesAdded: 1,
        cseCandidatesValidated: 1,
        cseEmailsInferred: 0,
        topSourceFamily: 'linkedin' as const,
        finalOutcome: 'recovery_opened' as const,
        verificationVerdict: 'verified' as const,
        supportingUrls: ['https://linkedin.com/in/atlas-founder'],
        diagnostics: [],
        topQueryFamily: 'DISCOVER_ROLES' as const,
      },
      attempts: [],
      topCandidates: [],
      websiteIntelligence: null,
      instagramIntelligence: null,
    },
  };
}

describe('buildServer', () => {
  const servers: Array<ReturnType<typeof buildServer>> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });
  });

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

  it('returns ready response with schema health details', async () => {
    const server = buildServer(makeDefaultOptions());
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      db: 'ok',
      schema: {
        status: 'ok',
        missingTables: [],
        missingEnumValues: [],
      },
    });
  });

  it('allows both apex and www variants of the configured CORS origin', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      env: {
        ...env,
        CORS_ORIGIN: 'https://zboonisales.com',
      },
    });
    servers.push(server);

    const response = await server.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://www.zboonisales.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://www.zboonisales.com');
  });

  it('returns not_ready when schema health fails', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      checkSchemaHealth: async () => ({
        status: 'fail',
        missingTables: ['contact_recovery_items'],
        missingEnumValues: ['MessageSendStatus:UNRESOLVED'],
        unexpectedTablePrivileges: ['public.MessageSend:authenticated:SELECT,UPDATE'],
        unexpectedDefaultPrivileges: ['postgres:public:TABLES:anon:INSERT,SELECT'],
      }),
    });
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'not_ready',
      db: 'ok',
      schema: {
        status: 'fail',
        missingTables: ['contact_recovery_items'],
        missingEnumValues: ['MessageSendStatus:UNRESOLVED'],
        unexpectedTablePrivileges: ['public.MessageSend:authenticated:SELECT,UPDATE'],
        unexpectedDefaultPrivileges: ['postgres:public:TABLES:anon:INSERT,SELECT'],
      },
    });
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

  it('does not reject empty JSON bodies when webhook raw-body parsing is enabled', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      resendWebhookSecret: 'test-resend-secret',
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: {
        'content-type': 'application/json',
      },
      payload: '',
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

  it('returns 422 when lead creation lacks ICP context', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      createLeadAndEnqueue: async () => {
        throw new LeadContextUnavailableError(
          'Lead creation requires an active ICP profile or an explicit icpProfileId',
        );
      },
    });
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

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: 'Lead creation requires an active ICP profile or an explicit icpProfileId',
      }),
    );
  });

  it('creates backup lead from source lead context and returns leadId/jobId', async () => {
    const createBackupLeadAndEnqueue = vi.fn(async () => ({
      leadId: 'backup_lead_1',
      jobId: 'backup_job_1',
    }));
    const server = buildServer({
      ...makeDefaultOptions(),
      getLeadById: async () => ({
        id: 'lead_1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: null,
        source: 'google_local',
        status: 'qualified',
        enrichmentData: null,
        error: null,
        createdAt: new Date('2026-03-08T00:00:00.000Z'),
        updatedAt: new Date('2026-03-08T00:00:00.000Z'),
      }),
      createBackupLeadAndEnqueue,
    });
    servers.push(server);

    const payload = {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      source: 'BACKUP_CONTACT_ROTATION',
    };

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads/lead_1/backup-contact',
      headers: authHeaders(),
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      leadId: 'backup_lead_1',
      jobId: 'backup_job_1',
    });
    expect(createBackupLeadAndEnqueue).toHaveBeenCalledWith('lead_1', payload);
  });

  it('returns 422 when source lead lacks backup staging context', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      getLeadById: async () => ({
        id: 'lead_1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: null,
        source: 'google_local',
        status: 'qualified',
        enrichmentData: null,
        error: null,
        createdAt: new Date('2026-03-08T00:00:00.000Z'),
        updatedAt: new Date('2026-03-08T00:00:00.000Z'),
      }),
      createBackupLeadAndEnqueue: async () => {
        throw new LeadContextUnavailableError(
          'Source lead does not have enough business qualification context to stage a backup contact',
        );
      },
    });
    servers.push(server);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/leads/lead_1/backup-contact',
      headers: authHeaders(),
      payload: {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        source: 'BACKUP_CONTACT_ROTATION',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: 'Source lead does not have enough business qualification context to stage a backup contact',
      }),
    );
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

  it('normalizes dirty lead emails before validating the list response', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      listLeads: async () => ({
        items: [
          {
            id: 'lead_1',
            firstName: 'Demo',
            lastName: 'Lead',
            email: 'info@example.com%20',
            source: 'maps_local',
            status: 'qualified',
            error: null,
            createdAt: '2026-04-11T00:00:00.000Z',
            updatedAt: '2026-04-11T00:00:00.000Z',
            latestIcpProfileId: null,
            latestScoreBand: null,
            latestBlendedScore: null,
            latestScorePredictionId: null,
            latestDiscoveryRawPayload: null,
            latestEnrichmentNormalizedPayload: null,
            latestEnrichmentRawPayload: null,
            businessCountryCode: null,
            businessCountry: null,
            businessCity: null,
            businessCategory: null,
            businessName: null,
            decisionMakerTitle: null,
          },
          {
            id: 'lead_2',
            firstName: 'Multi',
            lastName: 'Lead',
            email: 'sales@example.com,info@example.com',
            source: 'maps_local',
            status: 'qualified',
            error: null,
            createdAt: '2026-04-11T00:00:00.000Z',
            updatedAt: '2026-04-11T00:00:00.000Z',
            latestIcpProfileId: null,
            latestScoreBand: null,
            latestBlendedScore: null,
            latestScorePredictionId: null,
            latestDiscoveryRawPayload: null,
            latestEnrichmentNormalizedPayload: null,
            latestEnrichmentRawPayload: null,
            businessCountryCode: null,
            businessCountry: null,
            businessCity: null,
            businessCategory: null,
            businessName: null,
            decisionMakerTitle: null,
          },
          {
            id: 'lead_3',
            firstName: 'Bad',
            lastName: 'Lead',
            email: 'sales@example.',
            source: 'maps_local',
            status: 'qualified',
            error: null,
            createdAt: '2026-04-11T00:00:00.000Z',
            updatedAt: '2026-04-11T00:00:00.000Z',
            latestIcpProfileId: null,
            latestScoreBand: null,
            latestBlendedScore: null,
            latestScorePredictionId: null,
            latestDiscoveryRawPayload: null,
            latestEnrichmentNormalizedPayload: null,
            latestEnrichmentRawPayload: null,
            businessCountryCode: null,
            businessCountry: null,
            businessCity: null,
            businessCategory: null,
            businessName: null,
            decisionMakerTitle: null,
          },
        ],
        page: 1,
        pageSize: 20,
        total: 3,
      }),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads?page=1&pageSize=20',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [
        { id: 'lead_1', email: 'info@example.com' },
        { id: 'lead_2', email: 'sales@example.com' },
        { id: 'lead_3', email: 'unknown@lead.local' },
      ],
      page: 1,
      pageSize: 20,
      total: 3,
    });
  });

  it('returns paginated contact recovery list', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      listContactRecoveryItems: async () => ({
        items: [buildContactRecoveryItem('DECISION_MAKER_IDENTIFIED')],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads/recovery?page=1&pageSize=20',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [expect.objectContaining({ reason: 'DECISION_MAKER_IDENTIFIED' })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('keeps contact recovery browse shared for authenticated non-admin users', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      verifyAccessToken: async () => ({
        sub: NON_ADMIN_USER_ID,
        email: 'demo@lead-flood.local',
        firstName: 'Demo',
        lastName: 'User',
      }),
      listContactRecoveryItems: async () => ({
        items: [buildContactRecoveryItem('NO_EMAIL')],
        page: 1,
        pageSize: 20,
        total: 1,
      }),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads/recovery?page=1&pageSize=20',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [expect.objectContaining({ reason: 'NO_EMAIL' })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it('returns contact recovery detail when found', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      getContactRecoveryItem: async () => buildContactRecoveryItem('DECISION_MAKER_IDENTIFIED'),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/leads/recovery/recovery_1',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'recovery_1',
      reason: 'DECISION_MAKER_IDENTIFIED',
    });
  });

  it('rejects contact recovery item', async () => {
    const server = buildServer({
      ...makeDefaultOptions(),
      rejectContactRecoveryItem: async ({ id, rejectedBy }) => ({
        id,
        businessId: 'business_1',
        icpProfileId: 'icp_1',
        icpProfileName: 'Clinics',
        discoveryRunId: 'run_1',
        status: 'REJECTED',
        reason: 'NO_EMAIL',
        evidenceScore: 0.6,
        candidateCount: 1,
        rejectedBy,
        rejectedAt: '2026-03-08T00:00:00.000Z',
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
        business: {
          id: 'business_1',
          name: 'Atlas Clinic',
          city: 'Amman',
          country: 'Jordan',
          countryCode: 'JO',
          websiteDomain: 'atlas.example',
          instagramHandle: null,
          category: 'Dental Clinic',
          deterministicScore: 0.81,
          scoreBand: 'HIGH',
          preQualified: false,
          disqualificationReason: 'NO_EMAIL',
        },
        snapshot: {
          businessId: 'business_1',
          domain: 'atlas.example',
          locality: 'Amman, JO',
          generatedAt: '2026-03-08T00:00:00.000Z',
          businessInsights: null,
          genericBusinessEmail: 'info@atlas.example',
          telemetry: {
            cseVerifyAttempted: false,
            cseVerifySucceeded: false,
            cseDiscoverAttempted: true,
            cseDiscoverSucceeded: true,
            cseRawResults: 3,
            cseValidProfiles: 1,
            cseCandidatesAdded: 1,
            cseCandidatesValidated: 1,
            cseEmailsInferred: 0,
            topSourceFamily: 'company_page',
            finalOutcome: 'recovery_opened',
            verificationVerdict: 'skipped',
            supportingUrls: [],
            diagnostics: [],
            topQueryFamily: null,
          },
          attempts: [],
          topCandidates: [],
          websiteIntelligence: null,
          instagramIntelligence: null,
        },
      }),
    });
    servers.push(server);

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/leads/recovery/recovery_1/reject',
      headers: authHeaders(),
      payload: { reason: 'Founder is clearly a sole practitioner' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'recovery_1',
      status: 'REJECTED',
      rejectedBy: 'user_1',
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
        latestIcpProfileId: 'icp_1',
        phoneSource: 'APOLLO',
        businessEmail: 'hello@analytical-engines.example',
        contactDiscovery: {
          cseVerifyAttempted: true,
          cseVerifySucceeded: true,
          cseDiscoverAttempted: true,
          cseDiscoverSucceeded: false,
          cseRawResults: 5,
          cseValidProfiles: 2,
          cseCandidatesAdded: 1,
          cseCandidatesValidated: 1,
          cseEmailsInferred: 1,
          verificationVerdict: 'verified',
          supportingUrls: ['https://linkedin.com/in/ada-lovelace'],
          diagnostics: [
            {
              stage: 'DISCOVER',
              sourceFamily: 'linkedin',
              queryFamily: 'DISCOVER_ROLES',
              rawResultCount: 5,
              promotedCount: 1,
              verdict: 'verified',
            },
          ],
          topQueryFamily: 'DISCOVER_ROLES',
          topSourceFamily: 'linkedin',
          finalOutcome: 'lead_created',
          topCandidates: [
            {
              name: 'Ada Lovelace',
              title: 'Founder',
              sourceStage: 'V2',
              linkedinUrl: 'https://linkedin.com/in/ada-lovelace',
              email: 'ada@example.com',
              confidence: 0.91,
              matchedSignals: ['linkedin_profile', 'name_match', 'company_match'],
              verificationVerdict: 'verified',
              supportingUrls: ['https://linkedin.com/in/ada-lovelace'],
            },
          ],
        },
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
      latestIcpProfileId: 'icp_1',
      phoneSource: 'APOLLO',
      businessEmail: 'hello@analytical-engines.example',
      contactDiscovery: {
        topSourceFamily: 'linkedin',
        finalOutcome: 'lead_created',
      },
    });
  });

  it('returns 403 for non-admin job inspection requests', async () => {
    const getJobById = vi.fn(async () => null);
    const server = buildServer({
      ...makeDefaultOptions(),
      verifyAccessToken: async () => ({
        sub: NON_ADMIN_USER_ID,
        email: 'demo@lead-flood.local',
        firstName: 'Demo',
        lastName: 'User',
      }),
      getJobById,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/jobs/job_1',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(getJobById).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      [NON_ADMIN_USER_ID],
    );
  });

  it('returns 404 for missing job when requested by an app admin', async () => {
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    const server = buildServer({
      ...makeDefaultOptions(),
      verifyAccessToken: async () => ({
        sub: ADMIN_USER_ID,
        email: 'demo@lead-flood.local',
        firstName: 'Demo',
        lastName: 'User',
      }),
    });
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
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    const server = buildServer({
      ...makeDefaultOptions(),
      verifyAccessToken: async () => ({
        sub: ADMIN_USER_ID,
        email: 'demo@lead-flood.local',
        firstName: 'Demo',
        lastName: 'User',
      }),
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

  it('returns 403 for non-admin lead deletion requests', async () => {
    const softDeleteLead = vi.fn(async () => true);
    const server = buildServer({
      ...makeDefaultOptions(),
      verifyAccessToken: async () => ({
        sub: NON_ADMIN_USER_ID,
        email: 'demo@lead-flood.local',
        firstName: 'Demo',
        lastName: 'User',
      }),
      softDeleteLead,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/leads/lead_1',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(softDeleteLead).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      [NON_ADMIN_USER_ID],
    );
  });

  it('allows app admins to delete leads', async () => {
    const softDeleteLead = vi.fn(async () => true);
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    const server = buildServer({
      ...makeDefaultOptions(),
      verifyAccessToken: async () => ({
        sub: ADMIN_USER_ID,
        email: 'demo@lead-flood.local',
        firstName: 'Demo',
        lastName: 'User',
      }),
      softDeleteLead,
    });
    servers.push(server);

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/leads/lead_1',
      headers: authHeaders(),
    });

    expect(response.statusCode).toBe(204);
    expect(softDeleteLead).toHaveBeenCalledWith('lead_1');
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
