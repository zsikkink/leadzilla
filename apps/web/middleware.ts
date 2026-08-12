import { NextResponse } from 'next/server';

export function middleware() {
  // The recruiter UI is public and defaults to bundled, tokenless preview data.
  // Live API and admin routes enforce their own bearer-token boundaries.
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
