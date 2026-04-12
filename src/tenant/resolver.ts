import pg from 'pg';

export type Tenant = {
  id: string;
  code: string;
  name: string;
  keycloakRealm: string;
  keycloakIssuerUrl: string;
  status: 'active' | 'suspended';
};

type CacheEntry = {
  value: Tenant | null;
  expiresAt: number;
};

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 100;
const cache = new Map<string, CacheEntry>();

export function clearTenantCache(): void {
  cache.clear();
}

export async function resolveTenant(
  adminPool: pg.Pool,
  code: string,
): Promise<Tenant | null> {
  const now = Date.now();
  const cached = cache.get(code);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const { rows } = await adminPool.query<{
    id: string;
    code: string;
    name: string;
    keycloak_realm: string;
    keycloak_issuer_url: string;
    status: 'active' | 'suspended';
  }>(
    `SELECT id, code, name, keycloak_realm, keycloak_issuer_url, status
     FROM tenant WHERE code = $1`,
    [code],
  );

  const value: Tenant | null = rows[0]
    ? {
        id: rows[0].id,
        code: rows[0].code,
        name: rows[0].name,
        keycloakRealm: rows[0].keycloak_realm,
        keycloakIssuerUrl: rows[0].keycloak_issuer_url,
        status: rows[0].status,
      }
    : null;

  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(code, { value, expiresAt: now + TTL_MS });
  return value;
}
