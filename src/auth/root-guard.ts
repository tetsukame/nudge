import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { unsealRootSession, ROOT_SESSION_COOKIE, type RootSession } from './root-session';
import { loadConfig } from '@/config';

/**
 * Server component で root session を必須化する。
 * 未ログインなら /root/login へ redirect。
 */
export async function requireRootSession(): Promise<RootSession> {
  const sealed = (await cookies()).get(ROOT_SESSION_COOKIE)?.value;
  const cfg = loadConfig();
  const session = await unsealRootSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) {
    redirect('/root/login');
  }
  return session;
}

/**
 * API endpoint 用: NextResponse を返さないので呼び出し側で 401 を返す。
 */
export async function getRootSession(): Promise<RootSession | null> {
  const sealed = (await cookies()).get(ROOT_SESSION_COOKIE)?.value;
  const cfg = loadConfig();
  return unsealRootSession(sealed, cfg.IRON_SESSION_PASSWORD);
}
