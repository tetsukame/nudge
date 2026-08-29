/**
 * NDG-110 (v0.26): Keycloak 用の AuthProvider 実装。
 *
 * これまで route に直書きされていた openid-client 呼び出しをここに移し、
 * 他 IdP アダプタ (OIDC B の GenericOidcAdapter) と並列に置けるようにする。
 *
 * 実装自体は `openid-client` の標準機能をそのまま使っているだけで、
 * KC 固有処理はない (KC が OIDC 標準に準拠しているため)。KC アダプタと
 * 明示的に名乗るのは、tenant.keycloakIssuerUrl を採用元にしていることと、
 * OIDC C 以降で入る claim/role マッピングが KC の慣習に合わせた既定値を
 * 持つため。汎用 OIDC は OIDC B で `GenericOidcAdapter` として別追加する。
 */
import { generators } from 'openid-client';
import type { Tenant } from '../../tenant/resolver';
import { getOidcClient } from '../oidc-client';
import type {
  AuthChallenge,
  AuthProvider,
  CallbackResult,
} from './types';

export type KeycloakAdapterOptions = {
  clientId: string;
  clientSecret: string;
};

export class KeycloakAdapter implements AuthProvider {
  constructor(
    private tenant: Tenant,
    private opts: KeycloakAdapterOptions,
  ) {}

  async getAuthorizationUrl(
    challenge: AuthChallenge,
    redirectUri: string,
  ): Promise<string> {
    const client = await getOidcClient(this.tenant, {
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
      redirectUri,
    });
    return client.authorizationUrl({
      scope: 'openid email profile',
      state: challenge.state,
      nonce: challenge.nonce,
      code_challenge: generators.codeChallenge(challenge.codeVerifier),
      code_challenge_method: 'S256',
    });
  }

  async handleCallback(
    challenge: AuthChallenge,
    redirectUri: string,
    callbackUrl: string,
  ): Promise<CallbackResult> {
    const client = await getOidcClient(this.tenant, {
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
      redirectUri,
    });
    const params = client.callbackParams(callbackUrl);
    const tokenSet = await client.callback(redirectUri, params, {
      state: challenge.state,
      nonce: challenge.nonce,
      code_verifier: challenge.codeVerifier,
    });
    const c = tokenSet.claims();
    const email = (c.email as string | undefined) ?? '';
    const displayName =
      (c.name as string | undefined) ??
      (c.preferred_username as string | undefined) ??
      email;
    const rawGroups = (c as unknown as { groups?: unknown }).groups;
    const groups = Array.isArray(rawGroups)
      ? rawGroups.filter((g): g is string => typeof g === 'string')
      : undefined;

    return {
      claims: {
        sub: c.sub,
        email,
        displayName,
        groups,
        raw: c as unknown as Record<string, unknown>,
      },
      accessTokenExp: tokenSet.expires_at ?? 0,
    };
  }
}
