import type { NextRequest } from 'next/server';

function sanitizeBaseUrl(rawValue: string): string {
  return rawValue.replace(/\/+$/, '');
}

export async function GET(request: NextRequest): Promise<Response> {
  const authHeader = request.headers.get('authorization');
  const hasToken = authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 20;

  if (!hasToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiBaseUrl = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminApiKey = process.env.ADMIN_API_KEY;

  if (!apiBaseUrl || !adminApiKey) {
    return Response.json({ error: 'Dashboard count API is not configured' }, { status: 500 });
  }

  const upstreamUrl = `${sanitizeBaseUrl(apiBaseUrl)}/v1/admin/businesses?page=1&pageSize=1`;
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        authorization: authHeader,
        'x-admin-key': adminApiKey,
      },
    });
  } catch (error: unknown) {
    console.error('Dashboard business-count request failed', error);
    return Response.json({ error: 'Dashboard count is temporarily unavailable' }, { status: 503 });
  }

  const body = await upstreamResponse.json().catch(() => null);
  if (!upstreamResponse.ok) {
    console.error('Dashboard business-count upstream rejected request', {
      status: upstreamResponse.status,
      requestId: typeof body?.requestId === 'string' ? body.requestId : undefined,
    });
    return Response.json(
      { error: 'Dashboard count is temporarily unavailable' },
      { status: upstreamResponse.status },
    );
  }

  const total = typeof body?.total === 'number' ? body.total : null;
  if (total === null) {
    return Response.json({ error: 'Business count unavailable' }, { status: 502 });
  }

  return Response.json({ total });
}
