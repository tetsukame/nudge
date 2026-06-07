import type pg from 'pg';
import { withTenant } from '../db/with-tenant';
import { ROLE } from './_constants';

/**
 * NDG-93 (A3 P8): RSC ページが「ロール / 設定フラグ」を直列で複数取得する
 * パターンの共通化。
 *
 * Before:
 *   const isTenantAdmin = await withTenant(pool, tid, ...);
 *   const isTenantWideRequester = await withTenant(pool, tid, ...);
 *   const aiEnabled = await withTenant(pool, tid, ...);
 *   // → 3 接続 / 3 トランザクション
 *
 * After:
 *   const ctx = await loadPageContext(pool, tid, userId, { needAIEnabled: true });
 *   // → 1 接続 / 1 トランザクション、必要な項目のみクエリ
 *
 * 取得する項目は opts で選ぶ。指定がない項目はクエリしない。
 */

export type PageContextOptions = {
  /** tenant_ai_config.enabled の取得を要求する */
  needAIEnabled?: boolean;
  // 将来: needRetentionEnabled / needFooFlag 等を追加
};

export type PageContext = {
  isTenantAdmin: boolean;
  isTenantWideRequester: boolean;
  /** opts.needAIEnabled=true の時のみ true/false、それ以外は undefined */
  aiEnabled?: boolean;
};

export async function loadPageContext(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
  opts: PageContextOptions = {},
): Promise<PageContext> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows: roleRows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1
        AND role = ANY($2::text[])`,
      [userId, [ROLE.TENANT_ADMIN, ROLE.TENANT_WIDE_REQUESTER]],
    );
    const roles = new Set(roleRows.map((r) => r.role));
    const ctx: PageContext = {
      isTenantAdmin: roles.has(ROLE.TENANT_ADMIN),
      isTenantWideRequester: roles.has(ROLE.TENANT_WIDE_REQUESTER),
    };

    if (opts.needAIEnabled) {
      const { rows: aiRows } = await client.query(
        `SELECT 1 FROM tenant_ai_config
          WHERE tenant_id = $1 AND enabled = true LIMIT 1`,
        [tenantId],
      );
      ctx.aiEnabled = aiRows.length > 0;
    }

    return ctx;
  });
}
