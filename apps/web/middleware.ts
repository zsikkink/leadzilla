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

  // Check for Supabase auth cookies (sb-*-auth-token) or localStorage-synced header
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'));
  const hasAuthHeader = request.headers.get('authorization')?.startsWith('Bearer ');

  if (!hasAuthCookie && !hasAuthHeader) {
    // In dev mode, skip server-side redirect — the client-side AuthProvider
    // handles auth via localStorage (Supabase JS stores tokens there, not in cookies).
    // Without @supabase/ssr, there are no auth cookies for the middleware to check.
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.next();
    }

    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
