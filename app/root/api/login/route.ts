import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { loadConfig } from '@/config';
import { authenticatePlatformAdmin } from '@/domain/platform/auth';
import { sealRootSession, ROOT_SESSION_COOKIE } from '@/auth/root-session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { email?: string; password?: string };
  if (!b.email || !b.password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }

  const result = await authenticatePlatformAdmin(adminPool(), b.email, b.password);
  if (!result.ok) {
    // Don't disclose whether the account exists or is inactive.
    return NextResponse.json({ error: 'メールまたはパスワードが正しくありません' }, { status: 401 });
  }

  const cfg = loadConfig();
  const sealed = await sealRootSession(
    {
      adminId: result.admin.id,
      email: result.admin.email,
      displayName: result.admin.displayName,
      iat: Math.floor(Date.now() / 1000),
    },
    cfg.IRON_SESSION_PASSWORD,
  );

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ROOT_SESSION_COOKIE, sealed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/root',
    maxAge: 4 * 60 * 60, // 4 hours
  });
  return res;
}
