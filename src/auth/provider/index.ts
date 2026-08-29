/**
 * NDG-110 (v0.26): AuthProvider ファクトリ。
 *
 * route 側からは `getAuthProvider(tenant, opts)` で取得する。tenant の設定
 * を見て KC / 汎用 OIDC / (将来) local を切り替える単一ゲート。
 *
 * OIDC A (NDG-110) 時点では KC 固定。OIDC B (NDG-111) で tenant.authMode /
 * 認証設定テーブルを見て GenericOidcAdapter を返す分岐を追加する。
 */
import type { Tenant } from '../../tenant/resolver';
import { KeycloakAdapter, type KeycloakAdapterOptions } from './keycloak';
import type { AuthProvider } from './types';

export type AuthProviderOptions = KeycloakAdapterOptions;

export function getAuthProvider(
  tenant: Tenant,
  opts: AuthProviderOptions,
): AuthProvider {
  return new KeycloakAdapter(tenant, opts);
}

export type { AuthProvider, AuthChallenge, CallbackResult, UserClaims } from './types';
