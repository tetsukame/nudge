import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { encryptSecret, decryptSecret } from '../../notification/crypto';
import { assertSafeHttpUrl, SafeUrlError } from '../../lib/safe-url';
import { AUDIT_ACTION } from '../_constants';
import type { ActorContext } from '../types';

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

// ─────────────────────────────────────────────────────────
// Admin write ops (NDG-113 / Sub D)
// ─────────────────────────────────────────────────────────

export class AuthConfigError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'permission_denied' | 'not_found',
  ) {
    super(message);
    this.name = 'AuthConfigError';
  }
}

export type TenantAuthConfigView = {
  providerType: TenantAuthProviderType;
  issuerUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  claimMapping: Record<string, unknown>;
};

export type UpsertTenantAuthConfigInput = {
  providerType: TenantAuthProviderType;
  issuerUrl: string;
  clientId: string;
  /**
   * undefined → 既存の値を維持 (未入力の意)。空文字 → validation エラー
   * (secret 必須のため)。文字列 → 暗号化して置換。
   */
  clientSecret?: string;
  claimMapping?: Record<string, unknown>;
};

function ensureAdmin(actor: ActorContext) {
  if (!actor.isTenantAdmin) {
    throw new AuthConfigError('tenant_admin only', 'permission_denied');
  }
}

/**
 * 管理画面表示用。secret は含めず、`hasClientSecret` bool のみ返す。
 * row 無しは null (呼び出し側 UI で「未設定」表示)。
 */
export async function getTenantAuthConfigView(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<TenantAuthConfigView | null> {
  ensureAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      provider_type: TenantAuthProviderType;
      issuer_url: string;
      client_id: string;
      client_secret_encrypted: string;
      claim_mapping: Record<string, unknown>;
    }>(
      `SELECT provider_type, issuer_url, client_id, client_secret_encrypted, claim_mapping
       FROM tenant_auth_config WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      providerType: r.provider_type,
      issuerUrl: r.issuer_url,
      clientId: r.client_id,
      hasClientSecret: !!r.client_secret_encrypted,
      claimMapping: r.claim_mapping ?? {},
    };
  });
}

async function validate(input: UpsertTenantAuthConfigInput): Promise<void> {
  if (input.providerType !== 'keycloak' && input.providerType !== 'generic-oidc') {
    throw new AuthConfigError('invalid providerType', 'validation');
  }
  const issuer = input.issuerUrl?.trim();
  if (!issuer) throw new AuthConfigError('issuerUrl required', 'validation');
  try {
    await assertSafeHttpUrl(issuer, { allowLoopback: true });
  } catch (err) {
    if (err instanceof SafeUrlError) {
      throw new AuthConfigError(`issuerUrl invalid: ${err.message}`, 'validation');
    }
    throw err;
  }
  if (!input.clientId?.trim()) {
    throw new AuthConfigError('clientId required', 'validation');
  }
  // 空文字は明示的な validation エラー扱い (undefined = 既存維持と区別)
  if (input.clientSecret === '') {
    throw new AuthConfigError('clientSecret must not be empty', 'validation');
  }
}

/**
 * upsert。secret 未指定 (undefined) は既存維持、値指定なら暗号化置換。
 * 初回作成時に secret が無ければ validation エラーにする。
 */
export async function upsertTenantAuthConfig(
  pool: pg.Pool,
  actor: ActorContext,
  input: UpsertTenantAuthConfigInput,
): Promise<void> {
  ensureAdmin(actor);
  await validate(input);
  await withTenant(pool, actor.tenantId, async (client) => {
    const existing = await client.query<{ client_secret_encrypted: string }>(
      `SELECT client_secret_encrypted FROM tenant_auth_config WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const isCreate = existing.rowCount === 0;
    if (isCreate && input.clientSecret === undefined) {
      throw new AuthConfigError(
        'clientSecret required for initial setup',
        'validation',
      );
    }

    const params: unknown[] = [
      actor.tenantId,
      input.providerType,
      input.issuerUrl.trim(),
      input.clientId.trim(),
      JSON.stringify(input.claimMapping ?? {}),
    ];
    let secretClause: string;
    if (input.clientSecret === undefined) {
      secretClause = `(SELECT client_secret_encrypted FROM tenant_auth_config WHERE tenant_id=$1)`;
    } else {
      params.push(encryptSecret(input.clientSecret));
      secretClause = `$${params.length}`;
    }

    await client.query(
      `INSERT INTO tenant_auth_config
         (tenant_id, provider_type, issuer_url, client_id, claim_mapping, client_secret_encrypted)
       VALUES ($1, $2, $3, $4, $5::jsonb, ${secretClause})
       ON CONFLICT (tenant_id) DO UPDATE SET
         provider_type = EXCLUDED.provider_type,
         issuer_url = EXCLUDED.issuer_url,
         client_id = EXCLUDED.client_id,
         claim_mapping = EXCLUDED.claim_mapping,
         client_secret_encrypted = EXCLUDED.client_secret_encrypted,
         updated_at = now()`,
      params,
    );

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'tenant', $1, $4::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        AUDIT_ACTION.SETTINGS_AUTH_UPDATED,
        JSON.stringify({
          providerType: input.providerType,
          issuerUrl: input.issuerUrl.trim(),
          clientId: input.clientId.trim(),
          secretChanged: input.clientSecret !== undefined,
          isCreate,
        }),
      ],
    );
  });
}

/**
 * 認証設定を削除して env + tenant.keycloak_issuer_url フォールバックに戻す。
 * 誤操作で締め出されないよう、UI 側で確認ダイアログを必ず出す想定。
 */
export async function deleteTenantAuthConfig(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<void> {
  ensureAdmin(actor);
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rowCount } = await client.query(
      `DELETE FROM tenant_auth_config WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    if (rowCount === 0) {
      throw new AuthConfigError('no config to delete', 'not_found');
    }
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'tenant', $1, '{}'::jsonb)`,
      [actor.tenantId, actor.userId, AUDIT_ACTION.SETTINGS_AUTH_DELETED],
    );
  });
}
