import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

/**
 * CSP frame-ancestors を Microsoft Teams ドメインに対して許可する。
 * NDG-26: Teams Personal Tab として Nudge を iframe 表示するために必要。
 * 既存ドメイン (self) も維持している。
 */
const CSP_FRAME_ANCESTORS =
  "frame-ancestors 'self' teams.microsoft.com *.teams.microsoft.com *.skype.com *.cloud.microsoft *.microsoftonline.com";

function withCsp(response: NextResponse): NextResponse {
  response.headers.set('Content-Security-Policy', CSP_FRAME_ANCESTORS);
  return response;
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Short-circuit for non-tenant paths
  if (path === '/' || path.startsWith('/api/health')) {
    return withCsp(NextResponse.next());
  }

  // Tenant path validation: /t/<code>/...
  const m = path.match(/^\/t\/([^/]+)/);
  if (!m) {
    return withCsp(NextResponse.next());
  }

  const code = m[1];

  // Auth-required paths (pages, not API/auth routes)
  const isAuthRoute =
    path.includes('/login') ||
    path.includes('/auth/callback') ||
    path.includes('/logout') ||
    path.includes('/logged-out') ||
    // NDG-26: Teams Tab/Auth はセッションを「これから」作るので除外
    path.includes('/teams/');
  const isApiRoute = path.includes('/api/');

  if (isAuthRoute || isApiRoute) {
    return withCsp(NextResponse.next());
  }

  // For tenant pages: check session cookie exists (actual validation in server components / route handlers)
  const hasSession = request.cookies.has('nudge_session');
  if (!hasSession) {
    const loginUrl = new URL(`/t/${code}/login`, request.url);
    return withCsp(NextResponse.redirect(loginUrl));
  }

  return withCsp(NextResponse.next());
}
