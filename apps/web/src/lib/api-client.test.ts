import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ApiClient, ApiError } from './api-client.js';
import { LIVE_ACCESS_ENDED_MESSAGE, LIVE_DATA_REFRESH_MESSAGE } from './error-messages.js';

describe('ApiClient', () => {
  const baseUrl = 'http://localhost:5050';
  let getToken: () => string | null;
  let client: ApiClient;

  beforeEach(() => {
    getToken = vi.fn(() => 'test-token');
    client = new ApiClient(baseUrl, getToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends authorization header when token is present', async () => {
    const mockResponse = { items: [], page: 1, pageSize: 20, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listLeads({ page: 1, pageSize: 20, includeQualityMetrics: false });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/leads'),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('omits authorization header when no token', async () => {
    (getToken as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const mockResponse = { items: [], page: 1, pageSize: 20, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listLeads({ page: 1, pageSize: 20, includeQualityMetrics: false });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/leads'),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          authorization: expect.any(String),
        }),
      }),
    );
  });

  it('throws ApiError with status and message on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found', requestId: 'req-1' }), { status: 404 }),
    );

    await expect(client.getLead('bad-id')).rejects.toThrow(ApiError);
  });

  it('throws specific message on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );

    await expect(client.listLeads({ page: 1, pageSize: 20, includeQualityMetrics: false })).rejects.toThrow(
      LIVE_ACCESS_ENDED_MESSAGE,
    );
  });

  it('builds query params correctly', async () => {
    const mockResponse = { items: [], page: 1, pageSize: 10, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listLeads({
      page: 2,
      pageSize: 10,
      includeQualityMetrics: false,
      status: 'enriched',
      sortBy: 'score_desc',
    });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('page=2');
    expect(calledUrl).toContain('pageSize=10');
    expect(calledUrl).toContain('status=enriched');
    expect(calledUrl).toContain('sortBy=score_desc');
  });

  it('requests filtered dashboard aggregate analytics', async () => {
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-07-08T23:59:59.999Z';
    const icpProfileId = 'icp_1';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ avgScore: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));

    await client.getAvgScore({ from, to, icpProfileId });
    await client.getIcpPerformance({ from, to, icpProfileId });

    const avgScoreUrl = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string);
    expect(avgScoreUrl.pathname).toBe('/v1/analytics/avg-score');
    expect(avgScoreUrl.searchParams.get('from')).toBe(from);
    expect(avgScoreUrl.searchParams.get('to')).toBe(to);
    expect(avgScoreUrl.searchParams.get('icpProfileId')).toBe(icpProfileId);

    const icpPerformanceUrl = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as string);
    expect(icpPerformanceUrl.pathname).toBe('/v1/analytics/icp-performance');
    expect(icpPerformanceUrl.searchParams.get('from')).toBe(from);
    expect(icpPerformanceUrl.searchParams.get('to')).toBe(to);
    expect(icpPerformanceUrl.searchParams.get('icpProfileId')).toBe(icpProfileId);
  });

  it('requests the precomputed dashboard summary with filters', async () => {
    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-07-08T23:59:59.999Z';
    const icpProfileId = 'icp_1';
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          from,
          to,
          icpProfileId,
          generatedAt: '2026-07-08T23:59:59.999Z',
          dataFreshness: {
            qualityRollupBacked: true,
            qualityRollupLatestDay: '2026-07-08',
          },
          funnel: {},
          scoreDistribution: {},
          feedback: {},
          qualityTrends: { items: [] },
          avgScore: { avgScore: null },
          icpPerformance: { items: [] },
          pendingDraftsCount: 0,
          discoveryRuns: [],
          discoveryRunsTotal: 0,
        }),
        { status: 200 },
      ),
    );

    await client.getDashboardSummary({ from, to, icpProfileId });

    const calledUrl = new URL((fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string);
    expect(calledUrl.pathname).toBe('/v1/analytics/dashboard-summary');
    expect(calledUrl.searchParams.get('from')).toBe(from);
    expect(calledUrl.searchParams.get('to')).toBe(to);
    expect(calledUrl.searchParams.get('icpProfileId')).toBe(icpProfileId);
  });

  it('returns bundled demo dashboard snapshots without a network request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const operations = await client.getDemoOperationsDashboard();
    const analytics = await client.getDemoAnalyticsDashboard();

    expect(operations.kind).toBe('operations');
    expect(operations.metrics.length).toBeGreaterThan(0);
    expect(analytics.kind).toBe('analytics');
    expect(analytics.leadFlow.totalBusinesses).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws helpful error when API is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      client.listLeads({ page: 1, pageSize: 20, includeQualityMetrics: false }),
    ).rejects.toThrow(LIVE_DATA_REFRESH_MESSAGE);
  });

  it('retries retryable GET failures once', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Temporary gateway failure' }), { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], page: 1, pageSize: 20, total: 0 }), { status: 200 }),
      );

    await client.listLeads({ page: 1, pageSize: 20, includeQualityMetrics: false });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry mutating requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Temporary gateway failure' }), { status: 503 }),
    );

    await expect(
      client.createBackupLead('lead_1', {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        source: 'BACKUP_CONTACT_ROTATION',
      }),
    ).rejects.toThrow(LIVE_DATA_REFRESH_MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows a discovery run up to two minutes before aborting', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ runId: 'run_1', status: 'SUCCEEDED' }), { status: 201 }),
    );

    await client.createDiscoveryRun({
      icpProfileIds: ['icp_1'],
      countries: ['AE'],
      includeWebsiteAnalysis: true,
      includeSocialMediaAnalysis: true,
      limit: 5,
    });

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 120000);
  });

  it('requests the session-scoped demo run performance route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ run: { runId: 'run_1' }, tasks: [] }), { status: 200 }),
    );

    await client.getDemoDiscoveryRunPerformance('run_1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5050/v1/discovery/runs/run_1/performance',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('does not expose raw database errors returned by the API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error:
            'Database query failed for businesses (409): duplicate key value violates unique constraint "businesses_phone_idx"',
        }),
        { status: 409 },
      ),
    );

    await expect(
      client.createBackupLead('lead_1', {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        source: 'BACKUP_CONTACT_ROTATION',
      }),
    ).rejects.toThrow('This item changed while you were working. Refresh and try again.');
  });

  it('requests backup lead creation using the source lead route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ leadId: 'backup_lead_1', jobId: 'job_1' }), { status: 201 }),
    );

    await client.createBackupLead('lead_1', {
      firstName: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
      source: 'BACKUP_CONTACT_ROTATION',
    });

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/v1/leads/lead_1/backup-contact`,
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('requests contact recovery list with query params', async () => {
    const mockResponse = { items: [], page: 1, pageSize: 20, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listContactRecoveryItems({ page: 1, pageSize: 20, status: 'OPEN' });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/leads/recovery');
    expect(calledUrl).toContain('status=OPEN');
  });

  it('rejects a contact recovery item', async () => {
    const mockResponse = {
      id: 'recovery_1',
      businessId: 'business_1',
      icpProfileId: 'icp_1',
      icpProfileName: 'Clinics',
      discoveryRunId: 'run_1',
      status: 'REJECTED',
      reason: 'NO_EMAIL',
      evidenceScore: 0.61,
      candidateCount: 1,
      rejectedBy: 'user_1',
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
        genericBusinessEmail: null,
        telemetry: {
          cseVerifyAttempted: false,
          cseVerifySucceeded: false,
          cseDiscoverAttempted: true,
          cseDiscoverSucceeded: true,
          cseRawResults: 2,
          cseValidProfiles: 1,
          cseCandidatesAdded: 1,
          cseCandidatesValidated: 1,
          cseEmailsInferred: 0,
          topSourceFamily: 'company_page',
          finalOutcome: 'recovery_opened',
        },
        attempts: [],
        topCandidates: [],
        websiteIntelligence: null,
        instagramIntelligence: null,
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.rejectContactRecoveryItem('recovery_1', { reason: 'Not a fit' });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/leads/recovery/recovery_1/reject'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ reason: 'Not a fit' }),
      }),
    );
  });

  it('requests rejected leads with query params', async () => {
    const mockResponse = { items: [], page: 1, pageSize: 20, total: 0 };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.listRejectedLeads({ page: 1, pageSize: 20, reason: 'MANUAL' });

    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('/v1/leads/rejected');
    expect(calledUrl).toContain('reason=MANUAL');
  });

  it('replaces ICP rules', async () => {
    const mockResponse = { items: [] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await client.replaceIcpRules('icp_1', {
      rules: [
        {
          name: 'Country in region',
          fieldKey: 'country',
          operator: 'IN',
          valueJson: ['UAE'],
          orderIndex: 1,
        },
      ],
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/icps/icp_1/rules'),
      expect.objectContaining({
        method: 'PUT',
      }),
    );
  });
});
