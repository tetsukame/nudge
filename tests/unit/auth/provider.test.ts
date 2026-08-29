import { describe, it, expect } from 'vitest';
import { getAuthProvider } from '../../../src/auth/provider/index.js';
import { KeycloakAdapter } from '../../../src/auth/provider/keycloak.js';
import { GenericOidcAdapter } from '../../../src/auth/provider/generic-oidc.js';
import type { Tenant } from '../../../src/tenant/resolver.js';
import type { TenantAuthConfig } from '../../../src/domain/auth/config.js';

const tenant: Tenant = {
  id: 't1',
  code: 'demo',
  name: 'Demo',
  keycloakRealm: 'demo-realm',
  keycloakIssuerUrl: 'https://kc.example.com/realms/demo-realm',
  status: 'active',
  authMode: 'oidc',
};

const envOpts = { clientId: 'nudge-web', clientSecret: 'env-secret' };

describe('AuthProvider factory', () => {
  it('returns KeycloakAdapter when tenant_auth_config is null (env fallback)', () => {
    const provider = getAuthProvider(tenant, envOpts, null);
    expect(provider).toBeInstanceOf(KeycloakAdapter);
  });

  it('returns GenericOidcAdapter when config.providerType is generic-oidc', () => {
    const cfg: TenantAuthConfig = {
      providerType: 'generic-oidc',
      issuerUrl: 'https://pocket-id.example.com',
      clientId: 'nudge-pocket',
      clientSecret: 'db-secret',
      claimMapping: {},
    };
    const provider = getAuthProvider(tenant, envOpts, cfg);
    expect(provider).toBeInstanceOf(GenericOidcAdapter);
  });

  it('returns KeycloakAdapter when config.providerType is keycloak (uses config credentials, not env)', () => {
    const cfg: TenantAuthConfig = {
      providerType: 'keycloak',
      issuerUrl: 'https://kc-other.example.com/realms/x',
      clientId: 'nudge-other',
      clientSecret: 'db-secret',
      claimMapping: {},
    };
    const provider = getAuthProvider(tenant, envOpts, cfg);
    expect(provider).toBeInstanceOf(KeycloakAdapter);
  });

  it('AuthProvider interface has getAuthorizationUrl and handleCallback', () => {
    const provider = getAuthProvider(tenant, envOpts, null);
    expect(typeof provider.getAuthorizationUrl).toBe('function');
    expect(typeof provider.handleCallback).toBe('function');
  });
});
