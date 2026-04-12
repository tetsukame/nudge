import { describe, expect, it } from 'vitest';
import { buildEndSessionUrl } from '../../../src/auth/logout.js';

describe('buildEndSessionUrl', () => {
  it('builds URL with required params', () => {
    const url = buildEndSessionUrl({
      endSessionEndpoint: 'https://kc.example.com/realms/acme/protocol/openid-connect/logout',
      idTokenHint: undefined,
      postLogoutRedirectUri: 'http://localhost:3000/t/acme/logged-out',
      clientId: 'nudge-web',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      'https://kc.example.com/realms/acme/protocol/openid-connect/logout',
    );
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:3000/t/acme/logged-out',
    );
    expect(u.searchParams.get('client_id')).toBe('nudge-web');
  });

  it('includes id_token_hint if provided', () => {
    const url = buildEndSessionUrl({
      endSessionEndpoint: 'https://kc.example.com/realms/acme/protocol/openid-connect/logout',
      idTokenHint: 'eyJ...',
      postLogoutRedirectUri: 'http://localhost:3000/t/acme/logged-out',
      clientId: 'nudge-web',
    });
    const u = new URL(url);
    expect(u.searchParams.get('id_token_hint')).toBe('eyJ...');
  });
});
