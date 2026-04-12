import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { unsealSession } from '@/auth/session';
import { decideRoute } from '@/auth/middleware-guard';
import { loadConfig } from '@/config';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Resolve tenant if path is /t/<code>/...
  let tenant: { id: string; code: string } | null = null;
  const m = path.match(/^\/t\/([^/]+)/);
  if (m) {
    const resolved = await resolveTenant(adminPool(), m[1]);
    if (resolved) tenant = { id: resolved.id, code: resolved.code };
  }

  // Read session from cookie
  const cfg = loadConfig();
  const sealed = request.cookies.get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);

  const decision = decideRoute(path, tenant, session);

  if (decision.kind === 'passthrough') {
    return NextResponse.next();
  }
  if (decision.kind === 'not_found') {
    return new NextResponse('Not Found', { status: 404 });
  }
  // redirect
  const url = new URL(decision.to, request.url);
  return NextResponse.redirect(url);
}
