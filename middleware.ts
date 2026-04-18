import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Short-circuit for non-tenant paths
  if (path === '/' || path.startsWith('/api/health')) {
    return NextResponse.next();
  }

  // Tenant path validation: /t/<code>/...
  const m = path.match(/^\/t\/([^/]+)/);
  if (!m) {
    return NextResponse.next();
  }

  const code = m[1];

  // Auth-required paths (pages, not API/auth routes)
  const isAuthRoute = path.includes('/login') || path.includes('/auth/callback') || path.includes('/logout') || path.includes('/logged-out');
  const isApiRoute = path.includes('/api/');

  if (isAuthRoute || isApiRoute) {
    return NextResponse.next();
  }

  // For tenant pages: check session cookie exists (actual validation in server components / route handlers)
  const hasSession = request.cookies.has('nudge_session');
  if (!hasSession) {
    const loginUrl = new URL(`/t/${code}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
