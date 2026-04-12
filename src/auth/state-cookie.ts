import { sealData, unsealData } from 'iron-session';

export type OidcState = {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
};

const TTL_SECONDS = 10 * 60; // 10 minutes

export async function sealOidcState(
  s: OidcState,
  password: string,
): Promise<string> {
  return sealData(s, { password, ttl: TTL_SECONDS });
}

export async function unsealOidcState(
  sealed: string | undefined,
  password: string,
): Promise<OidcState | null> {
  if (!sealed) return null;
  try {
    const data = await unsealData<OidcState>(sealed, { password });
    if (!data || typeof data !== 'object' || !('state' in data)) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export const OIDC_STATE_COOKIE_NAME = 'nudge_oidc_state';
