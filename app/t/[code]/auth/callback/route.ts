import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getAuthProvider } from '@/auth/provider';
import {
  unsealOidcState,
  OIDC_STATE_COOKIE_NAME,
} from '@/auth/state-cookie';
import { jitUpsertUser } from '@/auth/callback';
import { sealSession } from '@/auth/session';
import type { NudgeSession } from '@/auth/session';
import { cookieSecure } from '@/auth/cookie-flags';
import { loadConfig } from '@/config';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 });

  const cfg = loadConfig();
  const sealed = req.cookies.get(OIDC_STATE_COOKIE_NAME)?.value;
  const state = await unsealOidcState(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!state) {
    return new NextResponse('OIDC state expired or missing', { status: 400 });
  }

  // login route と同じくリクエスト由来の host で算出。OIDC token exchange 時に
  // IdP は code 発行時の redirect_uri と一致することを要求するため、ここも揃える必要がある。
  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'http';
  const hostHeader = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const requestOrigin = `${forwardedProto}://${hostHeader}`;
  const redirectUri = `${requestOrigin}/t/${code}/auth/callback`;

  const provider = getAuthProvider(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
  });

  let callbackResult;
  try {
    callbackResult = await provider.handleCallback(
      {
        state: state.state,
        nonce: state.nonce,
        codeVerifier: state.codeVerifier,
      },
      redirectUri,
      req.url,
    );
  } catch (err) {
    logger.error({ err, tenantId: tenant.id }, 'OIDC callback failed');
    return new NextResponse('Authentication failed', { status: 400 });
  }

  const { sub, email, displayName } = callbackResult.claims;

  let userId: string;
  try {
    userId = await jitUpsertUser(appPool(), tenant.id, {
      sub,
      email,
      displayName,
    });
    logger.debug({ userId, tenantId: tenant.id }, 'jitUpsertUser OK');
  } catch (err) {
    logger.error({ err, tenantId: tenant.id }, 'jitUpsertUser failed');
    return new NextResponse('User provisioning failed', { status: 500 });
  }

  const session: NudgeSession = {
    userId,
    tenantId: tenant.id,
    tenantCode: tenant.code,
    sub,
    email,
    displayName,
    refreshToken: '', // Excluded from cookie to stay under 4096 byte browser limit
    accessTokenExp: callbackResult.accessTokenExp,
  };

  const sessionSealed = await sealSession(session, cfg.IRON_SESSION_PASSWORD);

  const returnUrl = new URL(state.returnTo, req.url);
  logger.debug(
    { userId, tenantId: tenant.id, returnTo: returnUrl.toString() },
    'callback session sealed, redirecting',
  );

  const maxAge = 14 * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  const secure = cookieSecure() ? '; Secure' : '';

  const headers = new Headers();
  headers.set('Location', returnUrl.toString());
  headers.append(
    'Set-Cookie',
    `nudge_session=${sessionSealed}; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; SameSite=Lax${secure}`,
  );
  headers.append(
    'Set-Cookie',
    `${OIDC_STATE_COOKIE_NAME}=; Path=/t/${code}/; Max-Age=0`,
  );
  return new Response(null, { status: 302, headers });
}
