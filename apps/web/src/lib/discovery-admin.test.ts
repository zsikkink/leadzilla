import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchJobRuns, triggerDiscoverySeed } from './discovery-admin.js';
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

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock(null));
    getSupabaseBrowserClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'session-token' } },
          error: null,
        }),
      },
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
