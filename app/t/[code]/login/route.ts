import { NextRequest, NextResponse } from 'next/server';
import { generators } from 'openid-client';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getAuthProvider } from '@/auth/provider';
import { sealOidcState, OIDC_STATE_COOKIE_NAME } from '@/auth/state-cookie';
import { cookieSecure } from '@/auth/cookie-flags';
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
  // redirectUri はリクエスト由来の host で算出する。req.nextUrl は Next.js が
  // 常に localhost に正規化してしまうため、x-forwarded-host → host ヘッダを直読みする。
  // cookie はオリジン単位なので、ユーザーが host.docker.internal でアクセスしている
  // 状態で localhost に redirect_uri を返すと、IdP からの戻りで cookie が送信されない。
  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'http';
  const hostHeader = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost:3000';
  const requestOrigin = `${forwardedProto}://${hostHeader}`;
  const redirectUri = `${requestOrigin}/t/${code}/auth/callback`;

  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();

  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? `/t/${code}/`;
  // Only allow same-origin, same-tenant return paths
  const safeReturnTo = returnTo.startsWith(`/t/${code}/`) ? returnTo : `/t/${code}/`;

  const sealed = await sealOidcState(
    { state, codeVerifier, nonce, returnTo: safeReturnTo },
    cfg.IRON_SESSION_PASSWORD,
  );

  const provider = getAuthProvider(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
  });
  const authorizationUrl = await provider.getAuthorizationUrl(
    { state, nonce, codeVerifier },
    redirectUri,
  );

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OIDC_STATE_COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: `/t/${code}/`,
    maxAge: 10 * 60,
  });
  return response;
}
