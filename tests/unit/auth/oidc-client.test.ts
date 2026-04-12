import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Tenant } from '../../../src/tenant/resolver.js';

const tenant: Tenant = {
  id: '00000000-0000-0000-0000-000000000001',
  code: 'acme',
  name: 'Acme',
  keycloakRealm: 'nudge-acme',
  keycloakIssuerUrl: 'https://kc.example.com/realms/nudge-acme',
  status: 'active',
};

let discoverCallCount = 0;

vi.mock('openid-client', async () => {
  const actual = await vi.importActual<typeof import('openid-client')>('openid-client');
  return {
    ...actual,
    Issuer: {
      async discover(url: string) {
        discoverCallCount++;
        return new actual.Issuer({
          issuer: url,
          authorization_endpoint: url + '/protocol/openid-connect/auth',
          token_endpoint: url + '/protocol/openid-connect/token',
          end_session_endpoint: url + '/protocol/openid-connect/logout',
          jwks_uri: url + '/protocol/openid-connect/certs',
        });
      },
    },
  };
});

describe('oidc client factory', () => {
  beforeEach(async () => {
    discoverCallCount = 0;
    const mod = await import('../../../src/auth/oidc-client.js');
    mod.clearIssuerCache();
  });

  it('creates a client for a tenant', async () => {
    const { getOidcClient } = await import('../../../src/auth/oidc-client.js');
    const client = await getOidcClient(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/t/acme/auth/callback',
    });
    expect(client).toBeDefined();
    expect(client.metadata.client_id).toBe('nudge-web');
  });

  it('caches the Issuer across calls for the same tenant', async () => {
    const { getOidcClient } = await import('../../../src/auth/oidc-client.js');
    await getOidcClient(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/t/acme/auth/callback',
    });
    await getOidcClient(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/t/acme/auth/callback',
    });
    expect(discoverCallCount).toBe(1);
  });
});
