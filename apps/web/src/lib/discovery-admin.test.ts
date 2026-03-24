import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchAdminLeadDetail,
  fetchAdminLeads,
  fetchAdminSearchTaskDetail,
  fetchAdminSearchTasks,
  fetchJobRequests,
  fetchJobRuns,
  triggerDiscoverySeed,
} from './discovery-admin.js';
import { getSupabaseBrowserClient } from './supabase-client.js';

vi.mock('./supabase-client.js', () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

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
  const getSupabaseBrowserClientMock = vi.mocked(getSupabaseBrowserClient);
  let fromMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fromMock = vi.fn(() => {
      throw new Error('Should not query Supabase directly');
    });
    vi.stubGlobal('localStorage', createStorageMock(null));
    getSupabaseBrowserClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'session-token' } },
          error: null,
        }),
      },
      from: fromMock,
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);
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
    expect(headers.get('authorization')).toBe('Bearer session-token');
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
    expect(headers.get('authorization')).toBe('Bearer session-token');
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
    expect(headers.get('authorization')).toBe('Bearer session-token');
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
    expect(fromMock).not.toHaveBeenCalled();
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
    expect(headers.get('authorization')).toBe('Bearer session-token');
    expect(result.lead.id).toBe('biz_1');
    expect(result.dedupeKeys.websiteDomain).toBe('alpha.example');
    expect(fromMock).not.toHaveBeenCalled();
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
    expect(headers.get('authorization')).toBe('Bearer session-token');
    expect(result.items[0]?.id).toBe('task_1');
    expect(result.items[0]?.runAfter).toBe('2026-03-14T12:00:00.000Z');
    expect(fromMock).not.toHaveBeenCalled();
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
    expect(headers.get('authorization')).toBe('Bearer session-token');
    expect(result.task.id).toBe('task_1');
    expect(result.linkedLeads[0]?.businessId).toBe('biz_1');
    expect(fromMock).not.toHaveBeenCalled();
  });

  // NOTE: checkDiscoveryAdminAccess tests were removed — the function moved to
  // use-discovery-admin-access.ts as a private helper and is tested through the hook.

  it('prefers the live session token over the stored token when both exist', async () => {
    vi.stubGlobal('localStorage', createStorageMock('stored-token'));

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
    expect(headers.get('authorization')).toBe('Bearer session-token');
  });

  it('posts discovery seed through the admin proxy using the stored token fallback', async () => {
    getSupabaseBrowserClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      },
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);
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
    getSupabaseBrowserClientMock.mockImplementation(() => {
      throw new Error('Supabase auth is not configured');
    });

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
    getSupabaseBrowserClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      },
    } as unknown as ReturnType<typeof getSupabaseBrowserClient>);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called');
    });

    await expect(fetchJobRuns('?page=1&pageSize=20')).rejects.toThrow('Not authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
