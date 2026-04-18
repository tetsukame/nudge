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

  let userId: string;
  try {
    userId = await jitUpsertUser(appPool(), tenant.id, {
      sub,
      email,
      displayName,
    });
    console.log('[callback] jitUpsertUser OK, userId:', userId);
  } catch (err) {
    console.error('[callback] jitUpsertUser FAILED:', err);
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
    accessTokenExp: tokenSet.expires_at ?? 0,
  };

  const sessionSealed = await sealSession(session, cfg.IRON_SESSION_PASSWORD);
  console.log('[callback] session sealed, length:', sessionSealed.length);

  const returnUrl = new URL(state.returnTo, req.url);
  console.log('[callback] redirecting to:', returnUrl.toString());

  const maxAge = 14 * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';

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
  console.log('[callback] Set-Cookie count:', headers.getSetCookie().length);
  console.log('[callback] Cookie value length:', sessionSealed.length);
  return new Response(null, { status: 302, headers });
}
