import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '../../app/api/admin/[...path]/route.js';

const originalApiBaseUrl = process.env.API_BASE_URL;
const originalPublicApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const originalAdminApiKey = process.env.ADMIN_API_KEY;

describe('web admin proxy route', () => {
  afterEach(() => {
    vi.restoreAllMocks();

    if (originalApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = originalApiBaseUrl;
    }

    if (originalPublicApiBaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_BASE_URL;
    } else {
      process.env.NEXT_PUBLIC_API_BASE_URL = originalPublicApiBaseUrl;
    }

    if (originalAdminApiKey === undefined) {
      delete process.env.ADMIN_API_KEY;
    } else {
      process.env.ADMIN_API_KEY = originalAdminApiKey;
    }
  });

  it('rejects unsupported admin paths before proxying upstream', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.ADMIN_API_KEY = 'test-admin-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called');
    });

    const request = new NextRequest('https://web.example.com/api/admin/debug-tools');
    const response = await GET(request, {
      params: Promise.resolve({ path: ['debug-tools'] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported admin route' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards allowed admin paths with the configured admin key', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.ADMIN_API_KEY = 'test-admin-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'x-upstream': 'yes' },
      }),
    );

    const request = new NextRequest('https://web.example.com/api/admin/leads?page=1&pageSize=1', {
      headers: {
        authorization: 'Bearer user-token',
        'x-admin-key': 'browser-supplied-key',
      },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['leads'] }),
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/v1/admin/leads?page=1&pageSize=1');

    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer user-token');
    expect(headers.get('x-admin-key')).toBe('test-admin-key');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('x-upstream')).toBe('yes');
  });

  it('forwards discovery-admin paths to the discovery-admin API prefix', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.ADMIN_API_KEY = 'test-admin-key';

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );

    const request = new NextRequest('https://web.example.com/api/admin/discovery-admin/recovery/recovery_1/approve', {
      method: 'POST',
      headers: {
        authorization: 'Bearer user-token',
      },
    });
    const response = await POST(request, {
      params: Promise.resolve({ path: ['discovery-admin', 'recovery', 'recovery_1', 'approve'] }),
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.com/v1/discovery-admin/recovery/recovery_1/approve');

    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBe('Bearer user-token');
    expect(headers.get('x-admin-key')).toBe('test-admin-key');

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('does not expose missing server configuration details', async () => {
    delete process.env.API_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    process.env.ADMIN_API_KEY = 'test-admin-key';

    const request = new NextRequest('https://web.example.com/api/admin/leads', {
      headers: { authorization: 'Bearer user-token' },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['leads'] }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'The admin service is temporarily unavailable.',
    });
  });

  it('does not expose upstream transport errors', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.ADMIN_API_KEY = 'test-admin-key';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED postgres.internal:5432'),
    );

    const request = new NextRequest('https://web.example.com/api/admin/leads', {
      headers: { authorization: 'Bearer user-token' },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['leads'] }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'The admin service is temporarily unavailable.',
    });
  });
});
