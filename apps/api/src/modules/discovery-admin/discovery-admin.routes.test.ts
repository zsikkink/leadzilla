import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbMocks, routeMocks } = vi.hoisted(() => ({
  dbMocks: {
    query: vi.fn(),
  },
  routeMocks: {
    buildDiscoveryAdminService: vi.fn(),
    PrismaDiscoveryAdminRepository: vi.fn(() => ({})),
    service: {
      getDiscoveryPhase1IcpLocationSummary: vi.fn(),
      getDiscoveryPhase1HistoricalSearchInputCohortSummaries: vi.fn(),
      listJobRequests: vi.fn(),
      cancelDiscoveryRun: vi.fn(),
    },
  },
}));

vi.mock('@lead-flood/db', () => ({
  query: dbMocks.query,
}));

vi.mock('./discovery-admin.service.js', () => ({
  buildDiscoveryAdminService: routeMocks.buildDiscoveryAdminService,
}));

vi.mock('./discovery-admin.repository.js', () => ({
  PrismaDiscoveryAdminRepository: routeMocks.PrismaDiscoveryAdminRepository,
}));

import { registerDiscoveryAdminRoutes } from './discovery-admin.routes.js';

describe('discovery-admin.routes job requests', () => {
  let app: FastifyInstance;
  let currentUserId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUserId = '11111111-1111-4111-8111-111111111111';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: true }],
    });
    routeMocks.buildDiscoveryAdminService.mockReturnValue(
      routeMocks.service as unknown,
    );
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      request.user = {
        sub: currentUserId,
        email: null,
        firstName: null,
        lastName: null,
      };
    });
    registerDiscoveryAdminRoutes(app, { adminApiKey: 'admin-key' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns admin-backed job requests for the jobs console', async () => {
    routeMocks.service.listJobRequests.mockResolvedValue({
      items: [
        {
          id: 21,
          requestType: 'DISCOVERY_RUN',
          status: 'PENDING',
          paramsJson: { maxTasks: 40 },
          requestedBy: 'user_1',
          claimedBy: null,
          createdAt: '2026-03-14T12:00:00.000Z',
          updatedAt: '2026-03-14T12:01:00.000Z',
          claimedAt: null,
          startedAt: null,
          finishedAt: null,
          errorText: null,
          jobRunId: null,
          idempotencyKey: 'idem_1',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/requests?page=1&pageSize=20&status=PENDING&requestType=DISCOVERY_RUN',
      headers: {
        'x-admin-key': 'admin-key',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      ['11111111-1111-4111-8111-111111111111'],
    );
    expect(routeMocks.service.listJobRequests).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: 'PENDING',
      requestType: 'DISCOVERY_RUN',
    });
    expect(response.json()).toEqual({
      items: [
        {
          id: 21,
          requestType: 'DISCOVERY_RUN',
          status: 'PENDING',
          paramsJson: { maxTasks: 40 },
          requestedBy: 'user_1',
          claimedBy: null,
          createdAt: '2026-03-14T12:00:00.000Z',
          updatedAt: '2026-03-14T12:01:00.000Z',
          claimedAt: null,
          startedAt: null,
          finishedAt: null,
          errorText: null,
          jobRunId: null,
          idempotencyKey: 'idem_1',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it('returns an admin-only phase-1 ICP/location summary for the requested run ids', async () => {
    routeMocks.service.getDiscoveryPhase1IcpLocationSummary.mockResolvedValue({
      locationBasis: 'ASSIGNED_SEARCH_TASK_LOCATION',
      cohorts: [
        {
          icpProfileId: 'icp_1',
          countryCode: 'AE',
          city: 'Dubai',
          assignmentCount: 5,
          measuredAssignmentCount: 3,
          phase1PositiveCount: 2,
          phase1NegativeCount: 1,
          holdoutAmbiguousCount: 1,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 0,
          measurementCoverageRate: 0.6,
          phase1PositiveRateAmongMeasuredAssignments: 2 / 3,
        },
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/runs/phase1-summary',
      headers: {
        'x-admin-key': 'admin-key',
      },
      payload: {
        runIds: ['run_1', 'run_2'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(routeMocks.service.getDiscoveryPhase1IcpLocationSummary).toHaveBeenCalledWith({
      runIds: ['run_1', 'run_2'],
    });
    expect(response.json()).toEqual({
      locationBasis: 'ASSIGNED_SEARCH_TASK_LOCATION',
      cohorts: [
        {
          icpProfileId: 'icp_1',
          countryCode: 'AE',
          city: 'Dubai',
          assignmentCount: 5,
          measuredAssignmentCount: 3,
          phase1PositiveCount: 2,
          phase1NegativeCount: 1,
          holdoutAmbiguousCount: 1,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 0,
          measurementCoverageRate: 0.6,
          phase1PositiveRateAmongMeasuredAssignments: 2 / 3,
        },
      ],
    });
  });

  it('rejects an invalid phase-1 summary payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/runs/phase1-summary',
      headers: {
        'x-admin-key': 'admin-key',
      },
      payload: {
        runIds: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Invalid discovery phase-1 summary payload',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.getDiscoveryPhase1IcpLocationSummary).not.toHaveBeenCalled();
  });

  it('returns historical phase-1 search-input cohort summaries across runs for the requested assignment window', async () => {
    routeMocks.service.getDiscoveryPhase1HistoricalSearchInputCohortSummaries.mockResolvedValue({
      searchInputBasis: 'ASSIGNED_SEARCH_TASK_INPUT',
      cohorts: [
        {
          icpProfileId: 'icp_1',
          taskType: 'SERP_GOOGLE',
          countryCode: 'AE',
          city: 'Dubai',
          language: 'en',
          normalizedQueryKey: 'dentist dubai',
          queryHash: 'query_hash_1',
          page: 1,
          timeBucket: 'weekday_morning',
          discoveryRunCount: 2,
          assignmentCount: 5,
          measuredAssignmentCount: 3,
          phase1PositiveCount: 2,
          phase1NegativeCount: 1,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 1,
          measurementCoverageRate: 0.6,
          phase1PositiveRateAmongMeasuredAssignments: 2 / 3,
        },
      ],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/runs/phase1-search-input-historical-cohort-summaries',
      headers: {
        'x-admin-key': 'admin-key',
      },
      payload: {
        assignedAtStart: '2026-03-01T00:00:00.000Z',
        assignedAtEnd: '2026-03-02T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(
      routeMocks.service.getDiscoveryPhase1HistoricalSearchInputCohortSummaries,
    ).toHaveBeenCalledWith({
      assignedAtStart: '2026-03-01T00:00:00.000Z',
      assignedAtEnd: '2026-03-02T00:00:00.000Z',
    });
    expect(response.json()).toEqual({
      searchInputBasis: 'ASSIGNED_SEARCH_TASK_INPUT',
      cohorts: [
        {
          icpProfileId: 'icp_1',
          taskType: 'SERP_GOOGLE',
          countryCode: 'AE',
          city: 'Dubai',
          language: 'en',
          normalizedQueryKey: 'dentist dubai',
          queryHash: 'query_hash_1',
          page: 1,
          timeBucket: 'weekday_morning',
          discoveryRunCount: 2,
          assignmentCount: 5,
          measuredAssignmentCount: 3,
          phase1PositiveCount: 2,
          phase1NegativeCount: 1,
          excludeOperationalCount: 1,
          excludeIncompleteCount: 1,
          measurementCoverageRate: 0.6,
          phase1PositiveRateAmongMeasuredAssignments: 2 / 3,
        },
      ],
    });
  });

  it('rejects an invalid historical phase-1 search-input cohort summary payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/runs/phase1-search-input-historical-cohort-summaries',
      headers: {
        'x-admin-key': 'admin-key',
      },
      payload: {
        assignedAtStart: '2026-03-02T00:00:00.000Z',
        assignedAtEnd: '2026-03-01T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Invalid discovery phase-1 historical search-input cohort summary payload',
      requestId: expect.any(String),
    });
    expect(
      routeMocks.service.getDiscoveryPhase1HistoricalSearchInputCohortSummaries,
    ).not.toHaveBeenCalled();
  });

  it('rejects historical phase-1 search-input cohort summaries for authenticated non-admin users', async () => {
    currentUserId = '22222222-2222-4222-8222-222222222222';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/runs/phase1-search-input-historical-cohort-summaries',
      headers: {
        'x-admin-key': 'admin-key',
      },
      payload: {
        assignedAtStart: '2026-03-01T00:00:00.000Z',
        assignedAtEnd: '2026-03-02T00:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(
      routeMocks.service.getDiscoveryPhase1HistoricalSearchInputCohortSummaries,
    ).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      ['22222222-2222-4222-8222-222222222222'],
    );
  });

  it('rejects phase-1 summaries for authenticated non-admin users', async () => {
    currentUserId = '22222222-2222-4222-8222-222222222222';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/discovery/runs/phase1-summary',
      headers: {
        'x-admin-key': 'admin-key',
      },
      payload: {
        runIds: ['run_1'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.getDiscoveryPhase1IcpLocationSummary).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      ['22222222-2222-4222-8222-222222222222'],
    );
  });

  it('rejects authenticated non-admin users even when they provide a valid admin key', async () => {
    currentUserId = '22222222-2222-4222-8222-222222222222';
    dbMocks.query.mockResolvedValue({
      rows: [{ isAdmin: false }],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/requests?page=1&pageSize=20',
      headers: {
        'x-admin-key': 'admin-key',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'Forbidden',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.listJobRequests).not.toHaveBeenCalled();
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.app_admins'),
      ['22222222-2222-4222-8222-222222222222'],
    );
  });

  it('still requires x-admin-key even for authenticated app admins', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/jobs/requests?page=1&pageSize=20',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'Unauthorized',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.listJobRequests).not.toHaveBeenCalled();
    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it('allows an authenticated user to cancel their own discovery run', async () => {
    routeMocks.service.cancelDiscoveryRun.mockResolvedValue({
      success: true,
      outcome: 'cancelled',
      terminalStatus: 'cancelled',
      cancelledPendingJobsCount: 2,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/discovery-admin/runs/run_123/cancel',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      outcome: 'cancelled',
      terminalStatus: 'cancelled',
      cancelledPendingJobsCount: 2,
    });
    expect(routeMocks.service.cancelDiscoveryRun).toHaveBeenCalledWith(
      'run_123',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it('returns not found when an authenticated user tries to cancel another user’s run', async () => {
    const { DiscoveryAdminNotFoundError } = await import('./discovery-admin.errors.js');
    currentUserId = '22222222-2222-4222-8222-222222222222';
    routeMocks.service.cancelDiscoveryRun.mockRejectedValue(
      new DiscoveryAdminNotFoundError('Discovery run not found'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/discovery-admin/runs/run_other/cancel',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'Discovery run not found',
      requestId: expect.any(String),
    });
    expect(routeMocks.service.cancelDiscoveryRun).toHaveBeenCalledWith(
      'run_other',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(dbMocks.query).not.toHaveBeenCalled();
  });
});
