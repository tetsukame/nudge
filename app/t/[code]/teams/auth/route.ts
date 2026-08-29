import { NextRequest, NextResponse } from 'next/server';
import * as jose from 'jose';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { jitUpsertUser } from '@/auth/callback';
import { sealSession } from '@/auth/session';
import type { NudgeSession } from '@/auth/session';
import { cookieSecure } from '@/auth/cookie-flags';
import { loadConfig } from '@/config';
import {
  exchangeEntraTokenForKcToken,
  TokenExchangeError,
} from '@/auth/teams-token-exchange';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

type Body = { entraToken?: unknown };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.entraToken !== 'string' || !body.entraToken) {
    return NextResponse.json({ error: 'entraToken_required' }, { status: 400 });
  }

  const cfg = loadConfig();
  if (!cfg.KC_ENTRA_IDP_ALIAS) {
    return NextResponse.json(
      { error: 'KC_ENTRA_IDP_ALIAS is not configured' },
      { status: 500 },
    );
  }

  let tokens;
  try {
    tokens = await exchangeEntraTokenForKcToken(body.entraToken, {
      issuerUrl: tenant.keycloakIssuerUrl,
      clientId: cfg.OIDC_CLIENT_ID,
      clientSecret: cfg.OIDC_CLIENT_SECRET,
      entraIdpAlias: cfg.KC_ENTRA_IDP_ALIAS,
    });
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      const status = err.status === 401 || err.status === 403 ? 401 : 502;
      return NextResponse.json(
        { error: 'token_exchange_failed', detail: err.message },
        { status },
      );
    }
    throw err;
  }

  // KC が発行した ID トークンの claims を読む。検証は KC 側で完了済み
  // (token-exchange の subject_token は KC 側で Entra に検証してもらっている)。
  const claims = jose.decodeJwt(tokens.idToken);
  const sub = claims.sub as string;
  const email = (claims.email as string | undefined) ?? '';
  const displayName =
    (claims.name as string | undefined) ??
    (claims.preferred_username as string | undefined) ??
    email;

  let userId: string;
  try {
    userId = await jitUpsertUser(appPool(), tenant.id, { sub, email, displayName });
  } catch (err) {
    logger.error({ err, tenantId: tenant.id }, 'teams/auth jitUpsertUser failed');
    return NextResponse.json({ error: 'user_provision_failed' }, { status: 500 });
  }

  const session: NudgeSession = {
    userId,
    tenantId: tenant.id,
    tenantCode: tenant.code,
    sub,
    email,
    displayName,
    refreshToken: '',
    accessTokenExp: tokens.expiresAt,
  };
  const sealed = await sealSession(session, cfg.IRON_SESSION_PASSWORD);

  const maxAge = 14 * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  const secure = cookieSecure() ? '; Secure' : '';

  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.append(
    'Set-Cookie',
    `nudge_session=${sealed}; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; SameSite=Lax${secure}`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
