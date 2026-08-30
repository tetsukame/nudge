import { NextRequest, NextResponse } from 'next/server';
import {
  emergencyLoginToTenant,
  isEmergencyLoginEnabled,
} from '@/domain/auth/emergency-login';
import { sealSession } from '@/auth/session';
import type { NudgeSession } from '@/auth/session';
import { cookieSecure } from '@/auth/cookie-flags';
import { loadConfig } from '@/config';

export const runtime = 'nodejs';

/**
 * NDG-118: 緊急ローカル管理者ログインの POST エンドポイント。
 * env `EMERGENCY_LOCAL_LOGIN=true` の時のみ 200 系を返す。それ以外は 404。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  if (!isEmergencyLoginEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { code } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const email = (body as { email?: unknown }).email;
  const password = (body as { password?: unknown }).password;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }

  const result = await emergencyLoginToTenant({
    tenantCode: code,
    email,
    password,
  });

  if (!result.ok) {
    if (result.error === 'tenant_not_found') {
      return NextResponse.json({ error: 'tenant not found' }, { status: 404 });
    }
    // disabled はここには来ない (先頭で弾いてる)。invalid / internal は 401 に丸める
    return NextResponse.json({ error: 'invalid credentials' }, { status: 401 });
  }

  const cfg = loadConfig();
  const session: NudgeSession = {
    userId: result.userId,
    tenantId: result.tenantId,
    tenantCode: result.tenantCode,
    sub: `emergency:${result.email.toLowerCase()}`,
    email: result.email,
    displayName: result.displayName,
    refreshToken: '',
    accessTokenExp: 0,
  };
  const sealed = await sealSession(session, cfg.IRON_SESSION_PASSWORD);

  const maxAge = 14 * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  const secure = cookieSecure() ? '; Secure' : '';

  const headers = new Headers();
  headers.append(
    'Set-Cookie',
    `nudge_session=${sealed}; Path=/; Max-Age=${maxAge}; Expires=${expires}; HttpOnly; SameSite=Lax${secure}`,
  );
  headers.set('content-type', 'application/json');
  return new NextResponse(
    JSON.stringify({
      ok: true,
      redirectTo: `/t/${code}/admin/settings/auth`,
    }),
    { status: 200, headers },
  );
}
