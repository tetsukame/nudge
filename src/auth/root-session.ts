import { sealData, unsealData } from 'iron-session';

export const ROOT_SESSION_COOKIE = 'nudge_root_session';

export type RootSession = {
  adminId: string;
  email: string;
  displayName: string;
  /** Issued-at unix seconds, used for re-auth UX */
  iat: number;
};

const TTL_SECONDS = 4 * 60 * 60; // 4 hours

export async function sealRootSession(
  session: RootSession,
  password: string,
): Promise<string> {
  return sealData(session, { password, ttl: TTL_SECONDS });
}

export async function unsealRootSession(
  sealed: string | undefined,
  password: string,
): Promise<RootSession | null> {
  if (!sealed) return null;
  try {
    const data = await unsealData<RootSession>(sealed, { password });
    if (!data || typeof data !== 'object' || !('adminId' in data)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
