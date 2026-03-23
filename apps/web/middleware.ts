import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/forgot-password'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths, API routes, and static assets
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.\w+$/)
  ) {
    return NextResponse.next();
  }

  // This app relies on the browser Supabase client, which persists the session
  // in localStorage rather than server-readable auth cookies. Enforcing a
  // production-only cookie redirect here breaks authenticated refreshes and
  // direct navigations. The client-side AppShell still redirects unauthenticated
  // users, and API routes remain protected by bearer-token verification.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
