import { sealSession, type NudgeSession } from '../../src/auth/session.js';
import { loadConfig } from '../../src/config.js';

export async function makeSessionCookie(
  overrides: { userId: string; tenantId: string; tenantCode: string; email?: string; displayName?: string },
): Promise<string> {
  const sess: NudgeSession = {
    userId: overrides.userId,
    tenantId: overrides.tenantId,
    tenantCode: overrides.tenantCode,
    sub: 'kc-' + overrides.userId,
    email: overrides.email ?? 'test@test',
    displayName: overrides.displayName ?? 'Test',
    refreshToken: '',
    accessTokenExp: Math.floor(Date.now() / 1000) + 3600,
  };
  const cfg = loadConfig();
  const sealed = await sealSession(sess, cfg.IRON_SESSION_PASSWORD);
  return `nudge_session=${sealed}`;
}
