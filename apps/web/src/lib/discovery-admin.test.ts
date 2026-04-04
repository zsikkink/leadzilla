import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkDiscoveryAdminAccess,
  fetchAdminBusinessDetail,
  fetchAdminBusinesses,
  fetchAdminLeadDetail,
  fetchAdminLeads,
  fetchAdminSearchTaskDetail,
  fetchAdminSearchTasks,
  fetchJobRequests,
  fetchJobRuns,
  triggerDiscoverySeed,
} from './discovery-admin.js';

const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

function createStorageMock(token: string | null): Storage {
  return {
    getItem: vi.fn((key: string) => (key === 'lf_access_token' ? token : null)),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: token ? 1 : 0,
  };
}

describe('discovery admin job proxy', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock('stored-token'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
  });

  it('fetches job runs through the admin proxy with the auth token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
        }),
        { status: 200 },
      ),
    );

    await fetchJobRuns('?page=1&pageSize=20');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/jobs/runs?page=1&pageSize=20');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
  });

  it('fetches job requests through the admin proxy with the auth token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
        }),
        { status: 200 },
      ),
    );

    await fetchJobRequests('?page=1&pageSize=20');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/jobs/requests?page=1&pageSize=20');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
  });

  it('fetches admin leads through the admin proxy and preserves the response shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'biz_1',
              name: 'Alpha Co',
              countryCode: 'AE',
              city: 'Dubai',
              category: 'Bakery',
              score: 0.73,
              scoreTier: 'HIGH',
              hasWhatsapp: true,
              hasInstagram: false,
              acceptsOnlinePayments: true,
              reviewCount: 48,
              followerCount: 1200,
              physicalAddressPresent: true,
              recentActivity: true,
              websiteDomain: 'alpha.example',
              phoneE164: '+971500000000',
              instagramHandle: 'alpha',
              createdAt: '2026-03-14T12:00:00.000Z',
              updatedAt: '2026-03-15T12:00:00.000Z',
            },
          ],
          page: 2,
          pageSize: 10,
          total: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAdminLeads('?page=2&pageSize=10&sortBy=score_desc&countries=AE,SA&city=Dubai&hasWhatsapp=true');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/leads?page=2&pageSize=10&sortBy=score_desc&countries=AE%2CSA&city=Dubai&hasWhatsapp=true');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(result).toEqual({
      items: [
        {
          id: 'biz_1',
          name: 'Alpha Co',
          countryCode: 'AE',
          city: 'Dubai',
          category: 'Bakery',
          score: 0.73,
          scoreTier: 'HIGH',
          hasWhatsapp: true,
          hasInstagram: false,
          acceptsOnlinePayments: true,
          reviewCount: 48,
          followerCount: 1200,
          physicalAddressPresent: true,
          recentActivity: true,
          websiteDomain: 'alpha.example',
          phoneE164: '+971500000000',
          instagramHandle: 'alpha',
          createdAt: '2026-03-14T12:00:00.000Z',
          updatedAt: '2026-03-15T12:00:00.000Z',
        },
      ],
      page: 2,
      pageSize: 10,
      total: 1,
    });
  });

  it('fetches admin businesses through the admin proxy and preserves the response shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'biz_1',
              name: 'Alpha Co',
              countryCode: 'AE',
              country: 'United Arab Emirates',
              city: 'Dubai',
              category: 'Bakery',
              rating: 4.7,
              reviewCount: 48,
              followerCount: 1200,
              deterministicScore: 0.73,
              scoreBand: 'HIGH',
              hasWhatsapp: true,
              hasInstagram: false,
              acceptsOnlinePayments: true,
              recentActivity: true,
              websiteDomain: 'alpha.example',
              phoneE164: '+971500000000',
              instagramHandle: 'alpha',
              preQualified: true,
              disqualificationReason: null,
              apifyWebsiteScrapeJson: null,
              apifyInstagramScrapeJson: null,
              websiteScrapedAt: null,
              instagramScrapedAt: null,
              manualReviewStatus: 'OPEN',
              manualReviewReason: 'NO_EMAIL',
              manualReviewUpdatedAt: '2026-03-15T12:00:00.000Z',
              leadBlendedScore: 0.81,
              leadId: 'lead_1',
              createdAt: '2026-03-14T12:00:00.000Z',
              updatedAt: '2026-03-15T12:00:00.000Z',
            },
          ],
          page: 1,
          pageSize: 30,
          total: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAdminBusinesses('?page=1&pageSize=30&q=alpha');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/businesses?page=1&pageSize=30&q=alpha');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(result.items[0]?.leadId).toBe('lead_1');
  });

  it('fetches admin business detail through the admin proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          business: {
            id: 'biz_1',
            name: 'Alpha Co',
            countryCode: 'AE',
            country: 'United Arab Emirates',
            city: 'Dubai',
            category: 'Bakery',
            rating: 4.7,
            reviewCount: 48,
            followerCount: 1200,
            deterministicScore: 0.73,
            scoreBand: 'HIGH',
            hasWhatsapp: true,
            hasInstagram: false,
            acceptsOnlinePayments: true,
            recentActivity: true,
            websiteDomain: 'alpha.example',
            phoneE164: '+971500000000',
            instagramHandle: 'alpha',
            preQualified: true,
            disqualificationReason: null,
            apifyWebsiteScrapeJson: null,
            apifyInstagramScrapeJson: null,
            websiteScrapedAt: null,
            instagramScrapedAt: null,
            manualReviewStatus: null,
            manualReviewReason: null,
            manualReviewUpdatedAt: null,
            leadBlendedScore: 0.81,
            leadId: 'lead_1',
            createdAt: '2026-03-14T12:00:00.000Z',
            updatedAt: '2026-03-15T12:00:00.000Z',
          },
          selectedContacts: [
            {
              id: 'contact_1',
              name: 'Jane Doe',
              title: 'Founder',
              email: 'jane@example.com',
              phone: '+971500000000',
              linkedinUrl: 'https://linkedin.com/in/jane',
              seniority: 'founder',
              positionRank: 0,
              source: 'manual',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAdminBusinessDetail('biz_1');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/businesses/biz_1');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(result.business.id).toBe('biz_1');
    expect(result.selectedContacts[0]?.name).toBe('Jane Doe');
  });

  it('fetches admin lead detail through the admin proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          lead: {
            id: 'biz_1',
            name: 'Alpha Co',
            countryCode: 'AE',
            city: 'Dubai',
            category: 'Bakery',
            score: 0.73,
            scoreTier: 'HIGH',
            hasWhatsapp: true,
            hasInstagram: false,
            acceptsOnlinePayments: true,
            reviewCount: 48,
            followerCount: 1200,
            physicalAddressPresent: true,
            recentActivity: true,
            websiteDomain: 'alpha.example',
            phoneE164: '+971500000000',
            instagramHandle: 'alpha',
            createdAt: '2026-03-14T12:00:00.000Z',
            updatedAt: '2026-03-15T12:00:00.000Z',
          },
          scoreBreakdown: {
            total: 0.73,
            tier: 'HIGH',
            contributions: [],
          },
          evidenceTimeline: [],
          dedupeKeys: {
            websiteDomain: 'alpha.example',
            phoneE164: '+971500000000',
            instagramHandle: 'alpha',
          },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAdminLeadDetail('biz_1');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/leads/biz_1');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(result.lead.id).toBe('biz_1');
    expect(result.dedupeKeys.websiteDomain).toBe('alpha.example');
  });

  it('fetches admin search tasks through the admin proxy and preserves the response shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'task_1',
              taskType: 'SERP_GOOGLE_LOCAL',
              status: 'FAILED',
              countryCode: 'AE',
              city: 'Dubai',
              language: 'en',
              queryText: 'bakery dubai',
              timeBucket: '2026-W08',
              attempts: 3,
              runAfter: '2026-03-14T12:00:00.000Z',
              lastResultHash: 'hash_1',
              error: 'boom',
              updatedAt: '2026-03-14T12:05:00.000Z',
              createdAt: '2026-03-14T11:55:00.000Z',
            },
          ],
          page: 2,
          pageSize: 5,
          total: 1,
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAdminSearchTasks('?page=2&pageSize=5&sortBy=attempts_desc&status=FAILED&taskType=SERP_GOOGLE_LOCAL&countryCode=ae&timeBucket=2026-W08');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/search-tasks?page=2&pageSize=5&sortBy=attempts_desc&status=FAILED&taskType=SERP_GOOGLE_LOCAL&countryCode=ae&timeBucket=2026-W08');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(result.items[0]?.id).toBe('task_1');
    expect(result.items[0]?.runAfter).toBe('2026-03-14T12:00:00.000Z');
  });

  it('fetches admin search task detail through the admin proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          task: {
            id: 'task_1',
            taskType: 'SERP_GOOGLE_LOCAL',
            status: 'DONE',
            countryCode: 'AE',
            city: 'Dubai',
            language: 'en',
            queryText: 'bakery dubai',
            timeBucket: '2026-W08',
            attempts: 1,
            runAfter: '2026-03-14T12:00:00.000Z',
            lastResultHash: 'hash_1',
            error: null,
            updatedAt: '2026-03-14T12:05:00.000Z',
            createdAt: '2026-03-14T11:55:00.000Z',
            paramsJson: { q: 'bakery dubai' },
            page: 1,
            derivedParams: {
              engine: 'google',
              q: 'bakery dubai',
              location: 'Dubai',
              gl: 'ae',
              hl: 'en',
              z: null,
              m: null,
              start: null,
            },
          },
          linkedLeads: [
            {
              businessId: 'biz_1',
              name: 'Alpha Co',
              countryCode: 'AE',
              city: 'Dubai',
              category: 'Bakery',
              score: 0.73,
              evidenceId: 'ev_1',
              evidenceCreatedAt: '2026-03-14T12:06:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await fetchAdminSearchTaskDetail('task_1');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/search-tasks/task_1');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(result.task.id).toBe('task_1');
    expect(result.linkedLeads[0]?.businessId).toBe('biz_1');
  });

  it('probes discovery admin access through the admin proxy', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [],
          page: 1,
          pageSize: 1,
          total: 0,
        }),
        { status: 200 },
      ),
    );

    await expect(checkDiscoveryAdminAccess()).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/search-tasks?page=1&pageSize=1&sortBy=updated_desc');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
  });

  it('surfaces forbidden admin access probes with status information', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403 },
      ),
    );

    await expect(checkDiscoveryAdminAccess()).rejects.toMatchObject({
      name: 'AdminProxyError',
      message: 'Forbidden',
      status: 403,
    });
  });

  it('posts discovery seed through the admin proxy using the stored token', async () => {
    vi.stubGlobal('localStorage', createStorageMock('stored-token'));

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          jobRunId: 'run_123',
          status: 'RUNNING',
        }),
        { status: 202 },
      ),
    );

    await triggerDiscoverySeed({ profile: 'small', maxTasks: 10 });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/admin/jobs/discovery/seed');
    expect((init as RequestInit | undefined)?.method).toBe('POST');

    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer stored-token');
    expect(headers.get('content-type')).toBe('application/json');
    expect((init as RequestInit | undefined)?.body).toBe(
      JSON.stringify({ profile: 'small', maxTasks: 10 }),
    );
  });

  it('omits the authorization header in local dev when Supabase is not configured', async () => {
    vi.stubGlobal('localStorage', createStorageMock(null));

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [],
          page: 1,
          pageSize: 20,
          total: 0,
        }),
        { status: 200 },
      ),
    );

    await fetchJobRuns('?page=1&pageSize=20');

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBeNull();
  });

  it('throws not authenticated when no token exists outside the unconfigured local-dev case', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    vi.stubGlobal('localStorage', createStorageMock(null));

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called');
    });

    await expect(fetchJobRuns('?page=1&pageSize=20')).rejects.toThrow('Not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
