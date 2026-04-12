import { sealData, unsealData } from 'iron-session';

export type NudgeSession = {
  userId: string;
  tenantId: string;
  tenantCode: string;
  sub: string;
  email: string;
  displayName: string;
  refreshToken: string;
  accessTokenExp: number;
};

const TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

export async function sealSession(
  session: NudgeSession,
  password: string,
): Promise<string> {
  return sealData(session, { password, ttl: TTL_SECONDS });
}

export async function unsealSession(
  sealed: string | undefined,
  password: string,
): Promise<NudgeSession | null> {
  if (!sealed) return null;
  try {
    const data = await unsealData<NudgeSession>(sealed, { password });
    if (!data || typeof data !== 'object' || !('userId' in data)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
