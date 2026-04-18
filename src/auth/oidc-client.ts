import { Issuer, Client } from 'openid-client';
import type { Tenant } from '../tenant/resolver';

export type OidcClientOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type CacheEntry = {
  issuer: Issuer;
  expiresAt: number;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour
const issuerCache = new Map<string, CacheEntry>();

export function clearIssuerCache(): void {
  issuerCache.clear();
}

async function getIssuer(tenant: Tenant): Promise<Issuer> {
  const now = Date.now();
  const cached = issuerCache.get(tenant.id);
  if (cached && cached.expiresAt > now) {
    return cached.issuer;
  }
  const issuer = await Issuer.discover(tenant.keycloakIssuerUrl);
  issuerCache.set(tenant.id, { issuer, expiresAt: now + TTL_MS });
  return issuer;
}

export async function getOidcClient(
  tenant: Tenant,
  opts: OidcClientOptions,
): Promise<Client> {
  const issuer = await getIssuer(tenant);
  return new issuer.Client({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uris: [opts.redirectUri],
    response_types: ['code'],
  });
}
