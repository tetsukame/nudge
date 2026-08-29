import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { logger } from '../../lib/logger';

/**
 * NDG-112 (v0.26): IdP claim → user_role 同期。
 *
 * IdP 側で管理する role の集合 (`managedRoles`) を宣言し、その集合内での
 * 差分 (追加/削除) だけを user_role テーブルに反映する。managedRoles に
 * 含まれない role (ローカルで直接付与された物) は一切触らない。
 *
 * ## managedRoles の決め方
 * tenant の claim_mapping.roles.map の値 (= マッピング先 Nudge role 名) の
 * ユニーク集合。IdP がその tenant で扱う可能性がある role リストなので、
 * 追加も削除もそのスコープ内でのみ動く。
 *
 * ## 例
 * user_role: {tenant_admin, tenant_wide_requester}
 * managedRoles: {tenant_admin, manager}
 * assignedByIdp: {manager}
 *   → tenant_admin は managed 内で assigned でないので削除
 *   → manager は managed 内で assigned なので追加
 *   → tenant_wide_requester は managed 外なので温存
 * 結果: {tenant_wide_requester, manager}
 */

export type RoleSyncResult = {
  added: string[];
  removed: string[];
};

export async function syncUserRolesFromIdP(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  managedRoles: Set<string>,
  assignedByIdp: Set<string>,
): Promise<RoleSyncResult> {
  if (managedRoles.size === 0) {
    // マッピングが空 → sync 対象なし。既存 role は完全に温存。
    return { added: [], removed: [] };
  }
  return withTenant(pool, tenantId, async (client) => {
    const { rows: existingRows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [userId],
    );
    const existing = new Set(existingRows.map((r) => r.role));

    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const r of managedRoles) {
      const shouldHave = assignedByIdp.has(r);
      const hasNow = existing.has(r);
      if (shouldHave && !hasNow) toAdd.push(r);
      if (!shouldHave && hasNow) toRemove.push(r);
    }

    for (const r of toAdd) {
      await client.query(
        `INSERT INTO user_role (tenant_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [tenantId, userId, r],
      );
    }
    for (const r of toRemove) {
      await client.query(
        `DELETE FROM user_role WHERE user_id = $1 AND role = $2`,
        [userId, r],
      );
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      logger.info(
        { tenantId, userId, added: toAdd, removed: toRemove },
        'IdP role sync applied',
      );
    }
    return { added: toAdd, removed: toRemove };
  });
}
