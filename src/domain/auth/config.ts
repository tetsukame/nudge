import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { decryptSecret } from '../../notification/crypto';

/**
 * NDG-111 (v0.26): tenant 認証設定 (`tenant_auth_config`) の読み取り。
 *
 * このモジュールは `AuthProvider` factory から呼ばれ、tenant がどの IdP
 * (keycloak / generic-oidc) を使うかを解決する。
 *
 * upsert / delete は Sub D (NDG-113) の管理 UI 経由で実装するため、
 * ここでは read のみ提供する。
 *
 * 後方互換: row 未登録 tenant は null を返し、呼び出し側 (factory) は
 * env `OIDC_CLIENT_ID/SECRET` + `tenant.keycloak_issuer_url` fallback に切替。
 */

export type TenantAuthProviderType = 'keycloak' | 'generic-oidc';

export type TenantAuthConfig = {
  providerType: TenantAuthProviderType;
  issuerUrl: string;
  clientId: string;
  /** 平文の client secret。crypto.decryptSecret で復号済み。 */
  clientSecret: string;
  claimMapping: Record<string, unknown>;
};

/**
 * 指定 tenant の tenant_auth_config を返す。row が無い / 復号失敗なら null。
 * RLS 前提で withTenant コンテキスト内で読む。
 */
export async function getTenantAuthConfig(
  pool: pg.Pool,
  tenantId: string,
): Promise<TenantAuthConfig | null> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{
      provider_type: TenantAuthProviderType;
      issuer_url: string;
      client_id: string;
      client_secret_encrypted: string;
      claim_mapping: Record<string, unknown>;
    }>(
      `SELECT provider_type, issuer_url, client_id, client_secret_encrypted, claim_mapping
       FROM tenant_auth_config
       WHERE tenant_id = $1`,
      [tenantId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    let clientSecret: string;
    try {
      clientSecret = decryptSecret(r.client_secret_encrypted);
    } catch {
      // 復号失敗は設定エラー扱い。呼び出し側で fallback するので null を返す。
      return null;
    }
    return {
      providerType: r.provider_type,
      issuerUrl: r.issuer_url,
      clientId: r.client_id,
      clientSecret,
      claimMapping: r.claim_mapping ?? {},
    };
  });
}
