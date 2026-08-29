/**
 * NDG-111 (v0.26): 汎用 OIDC プロバイダ用の AuthProvider 実装。
 *
 * Pocket ID / Authentik / Authelia / Entra ID など OIDC 標準準拠 IdP を
 * 追加設定なしで扱う。KC 固有概念 (realm 判定、admin API 呼び出し等) は
 * 含めない。tenant ごとの資格情報は tenant_auth_config テーブルから
 * 呼び出し側 (factory) が渡す。
 */
import { Issuer, generators } from 'openid-client';
import type {
  AuthChallenge,
  AuthProvider,
  CallbackResult,
} from './types';

export type GenericOidcAdapterOptions = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
};

// Issuer.discover はネットワーク I/O を伴うので tenant + issuer 単位でキャッシュ
type CacheEntry = { issuer: Issuer; expiresAt: number };
const TTL_MS = 60 * 60 * 1000;
const issuerCache = new Map<string, CacheEntry>();

export function clearGenericIssuerCache(): void {
  issuerCache.clear();
}

async function getCachedIssuer(url: string): Promise<Issuer> {
  const now = Date.now();
  const cached = issuerCache.get(url);
  if (cached && cached.expiresAt > now) return cached.issuer;
  const issuer = await Issuer.discover(url);
  issuerCache.set(url, { issuer, expiresAt: now + TTL_MS });
  return issuer;
}

export class GenericOidcAdapter implements AuthProvider {
  constructor(private opts: GenericOidcAdapterOptions) {}

  private async client(redirectUri: string) {
    const issuer = await getCachedIssuer(this.opts.issuerUrl);
    return new issuer.Client({
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
    });
  }

  async getAuthorizationUrl(
    challenge: AuthChallenge,
    redirectUri: string,
  ): Promise<string> {
    const client = await this.client(redirectUri);
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
    const client = await this.client(redirectUri);
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
