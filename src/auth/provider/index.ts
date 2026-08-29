/**
 * NDG-110 / NDG-111 (v0.26): AuthProvider ファクトリ。
 *
 * route 側からは `getAuthProvider(tenant, envOpts, config)` で取得する。
 * tenant_auth_config が存在するなら provider_type に従って
 * KeycloakAdapter / GenericOidcAdapter を切替、無ければ env + tenant KC 情報
 * にフォールバック (既存の全 tenant を破壊しないため)。
 *
 * OIDC C (NDG-112) で claim mapping を、OIDC D (NDG-113) で管理 UI 経由の
 * upsert を追加予定。
 */
import type { Tenant } from '../../tenant/resolver';
import type { TenantAuthConfig } from '../../domain/auth/config';
import { KeycloakAdapter, type KeycloakAdapterOptions } from './keycloak';
import { GenericOidcAdapter } from './generic-oidc';
import type { AuthProvider } from './types';

export type AuthProviderEnvOptions = KeycloakAdapterOptions;

/**
 * @param tenant  tenant.keycloak_issuer_url を KC フォールバックの issuer として使う
 * @param envOpts env `OIDC_CLIENT_ID / OIDC_CLIENT_SECRET` (config 未登録時の後方互換)
 * @param config  tenant_auth_config テーブルの内容。無ければ null → env + KC fallback
 */
export function getAuthProvider(
  tenant: Tenant,
  envOpts: AuthProviderEnvOptions,
  config: TenantAuthConfig | null,
): AuthProvider {
  if (!config) {
    // 後方互換: tenant_auth_config 未登録 → env 資格情報 + tenant.keycloakIssuerUrl
    return new KeycloakAdapter(tenant, envOpts);
  }
  if (config.providerType === 'generic-oidc') {
    return new GenericOidcAdapter({
      issuerUrl: config.issuerUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
  }
  // provider_type = 'keycloak'
  //   → tenant_auth_config 側の issuer/client を優先しつつ KeycloakAdapter を返す。
  //   KeycloakAdapter は現状 tenant.keycloakIssuerUrl を issuer 元にしているため、
  //   config 側の値で tenant を差し替えたエフェメラルなインスタンスを作る。
  const effectiveTenant: Tenant = {
    ...tenant,
    keycloakIssuerUrl: config.issuerUrl,
  };
  return new KeycloakAdapter(effectiveTenant, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });
}

export type {
  AuthProvider,
  AuthChallenge,
  CallbackResult,
  UserClaims,
} from './types';
