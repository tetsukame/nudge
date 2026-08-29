import { describe, it, expect } from 'vitest';
import { getAuthProvider } from '../../../src/auth/provider/index.js';
import { KeycloakAdapter } from '../../../src/auth/provider/keycloak.js';
import type { Tenant } from '../../../src/tenant/resolver.js';

describe('AuthProvider factory', () => {
  const tenant: Tenant = {
    id: 't1',
    code: 'demo',
    name: 'Demo',
    keycloakRealm: 'demo-realm',
    keycloakIssuerUrl: 'https://kc.example.com/realms/demo-realm',
    status: 'active',
    authMode: 'oidc',
  };

  it('returns KeycloakAdapter for the current default tenant', () => {
    const provider = getAuthProvider(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
    });
    expect(provider).toBeInstanceOf(KeycloakAdapter);
  });

  it('AuthProvider interface has getAuthorizationUrl and handleCallback', () => {
    const provider = getAuthProvider(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
    });
    expect(typeof provider.getAuthorizationUrl).toBe('function');
    expect(typeof provider.handleCallback).toBe('function');
  });
});
