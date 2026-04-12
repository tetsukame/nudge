export type AuthResult = { ok: true } | { ok: false; reason: string };

export function verifySyncAuth(
  authHeader: string | null,
  session: { roles: string[] } | null,
  configuredApiKey: string | undefined,
): AuthResult {
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (configuredApiKey && token === configuredApiKey) {
      return { ok: true };
    }
    return { ok: false, reason: 'Invalid API key' };
  }

  if (session && session.roles.includes('tenant_admin')) {
    return { ok: true };
  }

  return { ok: false, reason: 'Authentication required' };
}
