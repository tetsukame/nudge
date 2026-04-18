import type { NudgeSession } from './session';

export type TenantRef = { id: string; code: string };

export type RouteDecision =
  | { kind: 'passthrough' }
  | { kind: 'not_found' }
  | { kind: 'redirect'; to: string };

const NO_AUTH_SUFFIXES = new Set(['/login', '/auth/callback', '/logged-out']);

/**
 * Decide what to do with an incoming request based on path, tenant, and session.
 * tenant === null means "the code in the path did not resolve to a tenant".
 */
export function decideRoute(
  path: string,
  tenant: TenantRef | null,
  session: NudgeSession | null,
): RouteDecision {
  if (path === '/') return { kind: 'passthrough' };
  if (path.startsWith('/api/health')) return { kind: 'passthrough' };

  const m = path.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (!m) return { kind: 'not_found' };

  if (tenant === null) return { kind: 'not_found' };

  const rest = m[2] ?? '/';

  if (NO_AUTH_SUFFIXES.has(rest)) return { kind: 'passthrough' };

  if (!session || session.tenantId !== tenant.id) {
    const returnTo = encodeURIComponent(path);
    return {
      kind: 'redirect',
      to: `/t/${tenant.code}/login?returnTo=${returnTo}`,
    };
  }

  return { kind: 'passthrough' };
}
