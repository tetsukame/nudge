import { NextRequest, NextResponse } from 'next/server';
import { generators } from 'openid-client';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getOidcClient } from '@/auth/oidc-client';
import { sealOidcState, OIDC_STATE_COOKIE_NAME } from '@/auth/state-cookie';
import { loadConfig } from '@/config';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) {
    return new NextResponse('Tenant not found', { status: 404 });
  }

  const cfg = loadConfig();
  const redirectUri = `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/auth/callback`;
  const client = await getOidcClient(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    redirectUri,
  });

  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? `/t/${code}/`;
  // Only allow same-origin, same-tenant return paths
  const safeReturnTo = returnTo.startsWith(`/t/${code}/`) ? returnTo : `/t/${code}/`;

  const sealed = await sealOidcState(
    { state, codeVerifier, nonce, returnTo: safeReturnTo },
    cfg.IRON_SESSION_PASSWORD,
  );

  const authorizationUrl = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OIDC_STATE_COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/t/${code}/`,
    maxAge: 10 * 60,
  });
  return response;
}
