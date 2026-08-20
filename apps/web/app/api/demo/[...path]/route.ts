import type { NextRequest } from 'next/server';

const DEMO_SESSION_COOKIE = 'leadzilla-demo-session';
const DEMO_SESSION_HEADER = 'x-leadzilla-demo-session';
const DEMO_GATEWAY_HEADER = 'x-leadzilla-demo-gateway';
const MAX_REQUEST_BODY_BYTES = 16_384;
const UPSTREAM_TIMEOUT_MS = 8_000;
const LEAD_READ_UPSTREAM_TIMEOUT_MS = 20_000;
const DISCOVERY_RUN_UPSTREAM_TIMEOUT_MS = 110_000;

const ALLOWED_ROUTES = new Map([
  ['GET v1/icps', 'v1/demo/discovery/icps'],
  ['GET v1/settings/pipeline', 'v1/demo/discovery/settings'],
  ['GET v1/leads', 'v1/demo/leads'],
  ['GET v1/messaging/drafts', 'v1/demo/messaging/drafts'],
  ['GET v1/discovery/runs', 'v1/demo/discovery/runs'],
  ['POST v1/discovery/runs', 'v1/demo/discovery/runs'],
]);

function resolveUpstreamPath(method: string, path: string[]): string | null {
  const exactPath = ALLOWED_ROUTES.get(`${method} ${path.join('/')}`);
  if (exactPath) {
    return exactPath;
  }

  const leadId = path[2];
  if (
    path[0] === 'v1'
    && path[1] === 'leads'
    && leadId
    && /^[a-zA-Z0-9_-]{1,100}$/.test(leadId)
  ) {
    if (method === 'GET' && path.length === 3) {
      return `v1/demo/leads/${encodeURIComponent(leadId)}`;
    }
    if (method === 'POST' && path.length === 4 && path[3] === 'enrich') {
      return `v1/demo/leads/${encodeURIComponent(leadId)}/enrich`;
    }
  }

  const scoredLeadId = path[3];
  if (
    method === 'GET'
    && path.length === 5
    && path[0] === 'v1'
    && path[1] === 'scoring'
    && path[2] === 'leads'
    && scoredLeadId
    && /^[a-zA-Z0-9_-]{1,100}$/.test(scoredLeadId)
  ) {
    if (path[4] === 'latest') {
      return `v1/demo/leads/${encodeURIComponent(scoredLeadId)}/latest-score`;
    }
    if (path[4] === 'latest-feature-snapshot') {
      return `v1/demo/leads/${encodeURIComponent(scoredLeadId)}/latest-feature-snapshot`;
    }
    if (path[4] === 'latest-deterministic') {
      return `v1/demo/leads/${encodeURIComponent(scoredLeadId)}/latest-deterministic`;
    }
  }

  const runId = path[3];
  if (
    method === 'GET'
    && path.length === 5
    && path[0] === 'v1'
    && path[1] === 'discovery'
    && path[2] === 'runs'
    && path[4] === 'performance'
    && runId
    && /^[a-zA-Z0-9_-]{1,100}$/.test(runId)
  ) {
    return `v1/demo/discovery/runs/${encodeURIComponent(runId)}/performance`;
  }

  return null;
}

class DemoProxyRouteError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DemoProxyRouteError';
  }
}

function serverApiBaseUrl(): string {
  const value = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!value) {
    throw new Error('Demo API base URL is not configured');
  }
  return value.replace(/\/+$/, '');
}

function demoGatewaySecret(): string {
  const value = process.env.LEADZILLA_DEMO_GATEWAY_SECRET;
  if (!value) {
    throw new Error('Demo gateway secret is not configured');
  }
  return value;
}

function isSameOriginBrowserRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
      const requestHost = forwardedHost || request.headers.get('host') || request.nextUrl.host;
      const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const requestProtocol = forwardedProtocol
        ? `${forwardedProtocol}:`
        : request.nextUrl.protocol;

      if (originUrl.host !== requestHost || originUrl.protocol !== requestProtocol) {
        return false;
      }
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'same-site';
}

function validSessionId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function normalizedStringArray(
  value: unknown,
  options: { maxItems: number; maxLength: number; pattern?: RegExp },
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= options.maxLength)
    .filter((entry) => !options.pattern || options.pattern.test(entry));

  const unique = Array.from(new Set(normalized));
  if (unique.length > options.maxItems) {
    throw new DemoProxyRouteError('Public demo discovery targeting is outside the supported bounds.', 400);
  }
  return unique;
}

function normalizedCreateBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DemoProxyRouteError('Invalid discovery run payload', 400);
  }

  const body = value as Record<string, unknown>;
  const limit = body.limit === undefined ? 5 : Number(body.limit);
  const icpProfileIds = normalizedStringArray(body.icpProfileIds, { maxItems: 5, maxLength: 100 });
  const countries = normalizedStringArray(body.countries, {
    maxItems: 8,
    maxLength: 2,
    pattern: /^[a-z]{2}$/i,
  }).map((country) => country.toUpperCase());
  const cities = normalizedStringArray(body.cities, { maxItems: 20, maxLength: 80 });
  const advancedSettings = body.advancedSettings && typeof body.advancedSettings === 'object'
    ? body.advancedSettings as Record<string, unknown>
    : null;
  const searchCategories = normalizedStringArray(advancedSettings?.searchCategories, {
    maxItems: 5,
    maxLength: 80,
  });
  const minReviewCount = Number(advancedSettings?.minReviewCount ?? 0);

  if (!Number.isInteger(limit) || limit !== 5) {
    throw new DemoProxyRouteError('Public demo discovery runs use a fixed budget of 5 search tasks.', 400);
  }
  if (icpProfileIds.length === 0) {
    throw new DemoProxyRouteError('Choose at least one ICP before starting discovery.', 400);
  }
  if (countries.length === 0) {
    throw new DemoProxyRouteError('Choose at least one country before starting discovery.', 400);
  }

  return {
    icpProfileIds,
    countries,
    ...(cities.length > 0 ? { cities } : {}),
    includeWebsiteAnalysis: body.includeWebsiteAnalysis !== false,
    includeSocialMediaAnalysis: body.includeSocialMediaAnalysis !== false,
    limit,
    advancedSettings: {
      ...(searchCategories.length > 0 ? { searchCategories } : {}),
      minReviewCount: Number.isFinite(minReviewCount)
        ? Math.max(0, Math.min(5_000, Math.floor(minReviewCount)))
        : 0,
    },
  };
}

async function requestBody(request: NextRequest): Promise<string | undefined> {
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength === 0) {
    return undefined;
  }
  if (buffer.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new DemoProxyRouteError('Discovery run payload is too large.', 413);
  }

  try {
    return JSON.stringify(normalizedCreateBody(JSON.parse(new TextDecoder().decode(buffer))));
  } catch (error: unknown) {
    if (error instanceof DemoProxyRouteError) {
      throw error;
    }
    throw new DemoProxyRouteError('Invalid discovery run payload', 400);
  }
}

async function proxyDemoRequest(
  request: NextRequest,
  path: string[],
): Promise<Response> {
  if (!isSameOriginBrowserRequest(request)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const upstreamPath = resolveUpstreamPath(request.method.toUpperCase(), path);
  if (!upstreamPath) {
    return Response.json({ error: 'Unsupported demo route' }, { status: 404 });
  }

  try {
    const existingSessionId = request.cookies.get(DEMO_SESSION_COOKIE)?.value;
    const sessionId = validSessionId(existingSessionId) ? existingSessionId : crypto.randomUUID();
    const targetUrl = `${serverApiBaseUrl()}/${upstreamPath}${request.nextUrl.search}`;
    const headers = new Headers({
      accept: 'application/json',
      [DEMO_GATEWAY_HEADER]: demoGatewaySecret(),
      [DEMO_SESSION_HEADER]: sessionId,
    });
    const body = request.method === 'POST' ? await requestBody(request) : undefined;
    if (body) {
      headers.set('content-type', 'application/json');
      const requestedIdempotencyKey = request.headers.get('idempotency-key');
      headers.set(
        'idempotency-key',
        validSessionId(requestedIdempotencyKey ?? undefined)
          ? requestedIdempotencyKey!
          : crypto.randomUUID(),
      );
    }

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      ...(body ? { body } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(request.method === 'POST'
        ? DISCOVERY_RUN_UPSTREAM_TIMEOUT_MS
        : upstreamPath.startsWith('v1/demo/leads')
          ? LEAD_READ_UPSTREAM_TIMEOUT_MS
          : UPSTREAM_TIMEOUT_MS),
    });
    const responseHeaders = new Headers({
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    });
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) {
      responseHeaders.set('retry-after', retryAfter);
    }
    const response = new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });

    if (!validSessionId(existingSessionId)) {
      response.headers.append(
        'set-cookie',
        `${DEMO_SESSION_COOKIE}=${sessionId}; Path=/leadzilla; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
      );
    }

    return response;
  } catch (error: unknown) {
    if (error instanceof DemoProxyRouteError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('Demo discovery proxy request failed', error);
    return Response.json(
      { error: 'Live discovery is temporarily unavailable.' },
      { status: 502 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxyDemoRequest(request, path);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxyDemoRequest(request, path);
}
