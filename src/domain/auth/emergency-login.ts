import type pg from 'pg';
import { adminPool as getAdminPool, appPool as getAppPool } from '../../db/pools';
import { withTenant } from '../../db/with-tenant';
import { resolveTenant } from '../../tenant/resolver';
import { authenticatePlatformAdmin } from '../platform/auth';
import { logger } from '../../lib/logger';
import { AUDIT_ACTION } from '../_constants';

/**
 * NDG-118 (v0.26 Phase 3 I): 認証設定ミスで tenant_admin が締め出された場合の
 * 緊急ローカル復旧ログイン。
 *
 * ## 有効化
 *   環境変数 `EMERGENCY_LOCAL_LOGIN=true` の時のみ endpoint が生きる。
 *   OSS デフォルトは無効。ラボ環境で locked-out 事故が起きたときだけ
 *   `.env` に一時的に足して再起動する運用を想定。
 *
 * ## 前提
 *   platform_admin テーブルに登録済みの root 管理者 (bcrypt パスワード)。
 *   root 管理者は OIDC 設定が壊れていても KC/Pocket ID/etc に依存せず
 *   ログインできる (`/root/login` の bcrypt 認証)。この認証情報を
 *   tenant_admin セッションに昇格させて `/admin/settings/auth` の
 *   復旧作業をさせる。
 *
 * ## セキュリティ
 *   - env 未設定なら endpoint は 404 (存在自体を隠す)
 *   - パスワード検証は authenticatePlatformAdmin の bcrypt そのまま
 *   - 失敗理由の細分化はしない (invalid_credentials 一択)
 *   - 成功時: users 行 upsert (keycloak_sub = 'emergency:<email>') +
 *     user_role 'tenant_admin' 付与 + audit_log 記録
 */

export type EmergencyLoginError =
  | 'disabled'
  | 'invalid_credentials'
  | 'tenant_not_found'
  | 'internal';

export type EmergencyLoginSuccess = {
  ok: true;
  userId: string;
  tenantId: string;
  tenantCode: string;
  email: string;
  displayName: string;
};

export type EmergencyLoginResult =
  | EmergencyLoginSuccess
  | { ok: false; error: EmergencyLoginError };

export function isEmergencyLoginEnabled(): boolean {
  return process.env.EMERGENCY_LOCAL_LOGIN === 'true';
}

/**
 * platform_admin の email + password を検証し、指定 tenant の tenant_admin
 * として users 行を upsert する。成功したら route 側で nudge_session を発行。
 *
 * pool 引数は主にテスト用。省略時は adminPool / appPool を使う。
 */
export async function emergencyLoginToTenant(input: {
  tenantCode: string;
  email: string;
  password: string;
  adminPool?: pg.Pool;
  appPool?: pg.Pool;
}): Promise<EmergencyLoginResult> {
  if (!isEmergencyLoginEnabled()) {
    return { ok: false, error: 'disabled' };
  }

  const adminPool = input.adminPool ?? getAdminPool();
  const appPool = input.appPool ?? getAppPool();

  const tenant = await resolveTenant(adminPool, input.tenantCode);
  if (!tenant) return { ok: false, error: 'tenant_not_found' };

  const auth = await authenticatePlatformAdmin(
    adminPool,
    input.email,
    input.password,
  );
  if (!auth.ok) {
    logger.warn(
      { tenantId: tenant.id, email: input.email, reason: auth.error },
      'emergency login failed',
    );
    return { ok: false, error: 'invalid_credentials' };
  }
  const admin = auth.admin;

  try {
    const userId = await withTenant(appPool, tenant.id, async (client) => {
      // users を upsert。sub 名前空間 'emergency:' で他プロバイダと衝突しない
      const sub = `emergency:${admin.email.toLowerCase()}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, keycloak_sub)
         DO UPDATE SET
           email = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           updated_at = now()
         RETURNING id`,
        [tenant.id, sub, admin.email, admin.displayName],
      );
      const uid = rows[0].id;

      // tenant_admin ロールを付与 (既にあれば no-op)
      await client.query(
        `INSERT INTO user_role (tenant_id, user_id, role)
         VALUES ($1, $2, 'tenant_admin')
         ON CONFLICT DO NOTHING`,
        [tenant.id, uid],
      );

      // 監査ログ
      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
         VALUES ($1, $2, $3, 'tenant', $1, $4::jsonb)`,
        [
          tenant.id,
          uid,
          AUDIT_ACTION.LOGIN_EMERGENCY_LOCAL,
          JSON.stringify({
            platformAdminId: admin.id,
            email: admin.email,
          }),
        ],
      );
      return uid;
    });

    logger.info(
      { tenantId: tenant.id, userId, platformAdminId: admin.id },
      'emergency login succeeded',
    );

    return {
      ok: true,
      userId,
      tenantId: tenant.id,
      tenantCode: tenant.code,
      email: admin.email,
      displayName: admin.displayName,
    };
  } catch (err) {
    logger.error(
      { err, tenantId: tenant.id, platformAdminId: admin.id },
      'emergency login upsert failed',
    );
    return { ok: false, error: 'internal' };
  }
}
