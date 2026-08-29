/**
 * NDG-110 (v0.26): AuthProvider 抽象。
 *
 * OIDC ログインの「行き」と「帰り」を、KC / Pocket ID / Entra ID など IdP
 * 実装ごとの差分に依存せずに扱うためのインターフェース。
 *
 * ## 契約
 * - state / nonce / PKCE verifier は route 側で生成し、両メソッドに渡す
 *   (adapter 実装内で保存 / 取り出しをしない)
 * - claim → user 属性のマッピングも adapter 実装が担う (OIDC C で拡張)
 * - redirect_uri は request オリジンから毎回算出するため引数で渡す
 */

export type AuthChallenge = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

export type UserClaims = {
  sub: string;
  email: string;
  displayName: string;
  /** groups claim (OIDC C の role マッピングで使う。無ければ undefined) */
  groups?: string[];
  /**
   * OIDC C (NDG-112): 生の id_token claims。tenant 固有の claim mapping で
   * 独自 claim (roles / department / employeeType など) を参照するために使う。
   * PII が含まれる可能性があるため、ログ出力時はキー名のみに絞る。
   */
  raw: Record<string, unknown>;
};

export type CallbackResult = {
  claims: UserClaims;
  /** access token の有効期限 (UNIX epoch seconds)。unset なら 0 */
  accessTokenExp: number;
};

export type AuthProvider = {
  /** ログイン開始時、ユーザーをリダイレクトする IdP 側の URL を返す。 */
  getAuthorizationUrl(
    challenge: AuthChallenge,
    redirectUri: string,
  ): Promise<string>;

  /**
   * IdP からの callback を検証してトークン交換し、正規化された claim を返す。
   * state / nonce / PKCE の検証も内部で行う (失敗時は throw)。
   */
  handleCallback(
    challenge: AuthChallenge,
    redirectUri: string,
    callbackUrl: string,
  ): Promise<CallbackResult>;
};
