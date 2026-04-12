import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getOidcClient } from '@/auth/oidc-client';
import {
  unsealOidcState,
  OIDC_STATE_COOKIE_NAME,
} from '@/auth/state-cookie';
import { jitUpsertUser } from '@/auth/callback';
import { sealSession } from '@/auth/session';
import type { NudgeSession } from '@/auth/session';
import { loadConfig } from '@/config';

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

  const redirectUri = `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/auth/callback`;
  const client = await getOidcClient(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    redirectUri,
  });

  const params2 = client.callbackParams(req.url);
  let tokenSet;
  try {
    tokenSet = await client.callback(redirectUri, params2, {
      state: state.state,
      nonce: state.nonce,
      code_verifier: state.codeVerifier,
    });
  } catch (err) {
    console.error('OIDC callback failed', err);
    return new NextResponse('Authentication failed', { status: 400 });
  }

  const claims = tokenSet.claims();
  const sub = claims.sub;
  const email = (claims.email as string) ?? '';
  const displayName =
    (claims.name as string) ??
    (claims.preferred_username as string) ??
    email;

  const userId = await jitUpsertUser(appPool(), tenant.id, {
    sub,
    email,
    displayName,
  });

  const session: NudgeSession = {
    userId,
    tenantId: tenant.id,
    tenantCode: tenant.code,
    sub,
    email,
    displayName,
    refreshToken: tokenSet.refresh_token ?? '',
    accessTokenExp: tokenSet.expires_at ?? 0,
  };

  const sessionSealed = await sealSession(session, cfg.IRON_SESSION_PASSWORD);

  const response = NextResponse.redirect(
    new URL(state.returnTo, req.url),
  );
  response.cookies.set('nudge_session', sessionSealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/t/${code}/`,
    maxAge: 14 * 24 * 60 * 60,
  });
  // Clear the transient state cookie
  response.cookies.set(OIDC_STATE_COOKIE_NAME, '', {
    path: `/t/${code}/`,
    maxAge: 0,
  });
  return response;
}
