import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getOidcClient } from '@/auth/oidc-client';
import { buildEndSessionUrl } from '@/auth/logout';
import { loadConfig } from '@/config';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 });

  const cfg = loadConfig();
  const redirectUri = `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/auth/callback`;
  const client = await getOidcClient(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    redirectUri,
  });

  const endSessionEndpoint = client.issuer.metadata.end_session_endpoint;
  if (!endSessionEndpoint) {
    return new NextResponse('Keycloak realm has no end_session_endpoint', {
      status: 500,
    });
  }

  const logoutUrl = buildEndSessionUrl({
    endSessionEndpoint,
    idTokenHint: undefined,
    postLogoutRedirectUri: `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/logged-out`,
    clientId: cfg.OIDC_CLIENT_ID,
  });

  const response = NextResponse.redirect(logoutUrl);
  // Destroy local session
  response.cookies.set('nudge_session', '', {
    path: `/t/${code}/`,
    maxAge: 0,
  });
  return response;
}
