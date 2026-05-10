/**
 * Exchange an Entra (Azure AD) access token for Keycloak tokens via
 * Keycloak's RFC 8693 Token Exchange endpoint.
 *
 * Used in the Microsoft Teams SSO flow:
 *  - Teams JS SDK の getAuthToken() で Entra アクセストークンを取得
 *  - Nudge サーバ側がそのトークンを KC に渡し、KC が IdP broker
 *    (Entra) 経由でユーザを認識して KC アクセストークン + ID トークンを発行
 *  - Nudge は通常の callback と同じくユーザを upsert してセッションを発行
 *
 * Keycloak 26 では token-exchange は preview 機能のため、KC 起動時に
 * --features=token-exchange を有効化し、IdP broker に Stored Tokens を ON、
 * fine-grained permission で client に許可を付与する必要がある。
 * 詳細は docs/teams-integration.md を参照。
 */

export type TokenExchangeConfig = {
  /** KC realm の issuer URL (例: https://kc.example.com/realms/nudge) */
  issuerUrl: string;
  /** Nudge を表す KC client ID (例: nudge-web) */
  clientId: string;
  /** 上記 client の secret */
  clientSecret: string;
  /** KC に登録した Entra IdP broker の alias (例: entra) */
  entraIdpAlias: string;
};

export type TokenSet = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  /** Unix epoch seconds */
  expiresAt: number;
};

export class TokenExchangeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TokenExchangeError';
  }
}

export async function exchangeEntraTokenForKcToken(
  entraToken: string,
  config: TokenExchangeConfig,
): Promise<TokenSet> {
  const url = `${config.issuerUrl}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    subject_token: entraToken,
    subject_issuer: config.entraIdpAlias,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    let detail = '';
    try {
      const json = (await res.json()) as { error?: string; error_description?: string };
      detail = json.error_description ?? json.error ?? '';
    } catch {
      // body not JSON
    }
    throw new TokenExchangeError(
      `KC token exchange failed (${res.status}): ${detail}`,
      res.status,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    id_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}
