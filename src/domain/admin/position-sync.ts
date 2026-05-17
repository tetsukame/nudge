import type pg from 'pg';
import { applyTransferToManagerRoles } from './managers';

/**
 * KC 同期で取得した職位 (`nudge_position`) を NudgeFlow の「管理職」状態に反映する。
 *
 * ルール (NDG-48):
 * - `users.synced_position` には常に最新の position を記録する（admin UI 表示用）。
 * - `users.manager_source = 'manual'` のユーザーは手動運用中なので role を触らない。
 * - それ以外は `managerPositions` に position が含まれるかで manager ロールを
 *   付け外しし、`manager_source = 'kc'` を立てる。変化があれば
 *   applyTransferToManagerRoles で org_unit_manager を再計算する。
 *
 * reconcileUsers の full / delta 双方から user 1 件ごとに呼ばれる。
 * tenant スコープの client（withTenant 配下）で実行すること。
 */
export async function applySyncedPosition(
  client: pg.PoolClient,
  tenantId: string,
  userId: string,
  position: string | null | undefined,
  managerPositions: string[],
): Promise<void> {
  const normalized = position && position.trim() ? position.trim() : null;

  const { rows: uRows } = await client.query<{ manager_source: string | null }>(
    `SELECT manager_source FROM users WHERE id = $1`,
    [userId],
  );
  if (uRows.length === 0) return;

  // Always record the latest synced position for visibility.
  await client.query(
    `UPDATE users SET synced_position = $1 WHERE id = $2`,
    [normalized, userId],
  );

  // Manual override wins — never let sync flip a hand-managed user.
  if (uRows[0].manager_source === 'manual') return;

  const shouldBeManager =
    normalized != null && managerPositions.includes(normalized);

  const { rows: roleRows } = await client.query(
    `SELECT 1 FROM user_role WHERE user_id = $1 AND role = 'manager'`,
    [userId],
  );
  const isManager = roleRows.length > 0;

  if (shouldBeManager === isManager) {
    // No role change needed; still stamp the source so future manual
    // toggles can be distinguished.
    await client.query(
      `UPDATE users SET manager_source = 'kc' WHERE id = $1`,
      [userId],
    );
    return;
  }

  if (shouldBeManager) {
    await client.query(
      `INSERT INTO user_role (tenant_id, user_id, role)
       VALUES ($1, $2, 'manager')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [tenantId, userId],
    );
  } else {
    await client.query(
      `DELETE FROM user_role WHERE user_id = $1 AND role = 'manager'`,
      [userId],
    );
  }
  await client.query(
    `UPDATE users SET manager_source = 'kc' WHERE id = $1`,
    [userId],
  );

  // Recompute org_unit_manager (wipe + reattach primary if now manager).
  await applyTransferToManagerRoles(client, tenantId, null, userId);

  await client.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
     VALUES ($1, NULL, 'user_role.manager_synced', 'user', $2, $3::jsonb)`,
    [
      tenantId,
      userId,
      JSON.stringify({ position: normalized, shouldBeManager }),
    ],
  );
}

/** テナントの「管理職とみなす職位」一覧を取得（未設定はデフォルト）。 */
export async function getManagerPositions(
  client: pg.PoolClient,
  tenantId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ manager_positions: string[] }>(
    `SELECT manager_positions FROM tenant_position_config WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) return ['課長', '部長', '室長', '本部長'];
  return rows[0].manager_positions;
}
