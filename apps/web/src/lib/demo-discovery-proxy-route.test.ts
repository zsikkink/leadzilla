import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET, POST } from '../../app/api/demo/[...path]/route.js';

const originalApiBaseUrl = process.env.API_BASE_URL;
const originalGatewaySecret = process.env.LEADZILLA_DEMO_GATEWAY_SECRET;

describe('public demo discovery proxy route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalApiBaseUrl === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = originalApiBaseUrl;
    if (originalGatewaySecret === undefined) delete process.env.LEADZILLA_DEMO_GATEWAY_SECRET;
    else process.env.LEADZILLA_DEMO_GATEWAY_SECRET = originalGatewaySecret;
  });

  it('rejects paths outside the exact discovery allowlist', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest('https://web.example.com/leadzilla/api/demo/v1/messaging/sends');
    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'messaging', 'sends'] }),
    });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards a same-origin read with a private gateway key and HttpOnly session cookie', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.LEADZILLA_DEMO_GATEWAY_SECRET = 'server-only-demo-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ items: [] }),
    );
    const request = new NextRequest('https://web.example.com/leadzilla/api/demo/v1/icps?page=1', {
      headers: { origin: 'https://web.example.com', 'sec-fetch-site': 'same-origin' },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'icps'] }),
    });

    const [target, init] = fetchMock.mock.calls[0] ?? [];
    expect(target).toBe('https://api.example.com/v1/demo/discovery/icps?page=1');
    const headers = new Headers((init as RequestInit | undefined)?.headers);
    expect(headers.get('x-leadzilla-demo-gateway')).toBe('server-only-demo-key');
    expect(headers.get('x-leadzilla-demo-session')).toMatch(/^[0-9a-f-]{36}$/i);
    expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax');
  });

  it('uses the incoming host when Next is configured with a different local hostname', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.LEADZILLA_DEMO_GATEWAY_SECRET = 'server-only-demo-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ items: [] }),
    );
    const request = new NextRequest('http://localhost:3002/leadzilla/api/demo/v1/icps', {
      headers: {
        host: '127.0.0.1:3002',
        origin: 'http://127.0.0.1:3002',
        'sec-fetch-site': 'same-origin',
      },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'icps'] }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forwards a safe run-performance read without widening the route allowlist', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.LEADZILLA_DEMO_GATEWAY_SECRET = 'server-only-demo-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ run: { runId: 'run_1' }, tasks: [] }),
    );
    const request = new NextRequest(
      'https://web.example.com/leadzilla/api/demo/v1/discovery/runs/run_1/performance',
      { headers: { origin: 'https://web.example.com' } },
    );
    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'discovery', 'runs', 'run_1', 'performance'] }),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/demo/discovery/runs/run_1/performance',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('normalizes a bounded create request and strips client-supplied actor fields', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.LEADZILLA_DEMO_GATEWAY_SECRET = 'server-only-demo-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ runId: 'run_1', status: 'SUCCEEDED' }, { status: 201 }),
    );
    const request = new NextRequest('https://web.example.com/leadzilla/api/demo/v1/discovery/runs', {
      method: 'POST',
      headers: {
        cookie: 'leadzilla-demo-session=21ec2020-3aea-4d06-a051-bb44cc6cf55a',
        origin: 'https://web.example.com',
      },
      body: JSON.stringify({
        icpProfileIds: ['icp_1'],
        countries: ['us'],
        cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'],
        limit: 5,
        requestedByUserId: 'attacker-controlled',
      }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ path: ['v1', 'discovery', 'runs'] }),
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const forwarded = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
    expect(forwarded).toMatchObject({
      icpProfileIds: ['icp_1'],
      countries: ['US'],
      cities: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'],
      limit: 5,
    });
    expect(forwarded).not.toHaveProperty('requestedByUserId');
    expect(response.status).toBe(201);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each([4, 6])('rejects a %i-task budget before calling upstream', async (limit) => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.LEADZILLA_DEMO_GATEWAY_SECRET = 'server-only-demo-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest('https://web.example.com/leadzilla/api/demo/v1/discovery/runs', {
      method: 'POST',
      body: JSON.stringify({ icpProfileIds: ['icp_1'], countries: ['US'], limit }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ path: ['v1', 'discovery', 'runs'] }),
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized targeting instead of silently dropping selections', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.LEADZILLA_DEMO_GATEWAY_SECRET = 'server-only-demo-key';
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest('https://web.example.com/leadzilla/api/demo/v1/discovery/runs', {
      method: 'POST',
      body: JSON.stringify({
        icpProfileIds: ['icp_1', 'icp_2', 'icp_3', 'icp_4', 'icp_5', 'icp_6'],
        countries: ['US'],
        limit: 5,
      }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ path: ['v1', 'discovery', 'runs'] }),
    });

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-origin browser requests', async () => {
    const request = new NextRequest('https://web.example.com/leadzilla/api/demo/v1/icps', {
      headers: { origin: 'https://attacker.example.com' },
    });
    const response = await GET(request, {
      params: Promise.resolve({ path: ['v1', 'icps'] }),
    });
    expect(response.status).toBe(403);
  });
});
