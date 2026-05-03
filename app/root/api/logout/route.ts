import { NextResponse } from 'next/server';
import { ROOT_SESSION_COOKIE } from '@/auth/root-session';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ROOT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/root',
    maxAge: 0,
  });
  return res;
}
