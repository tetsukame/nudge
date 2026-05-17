import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class ManagerError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found' | 'validation',
  ) {
    super(message);
    this.name = 'ManagerError';
  }
}

export type ManagedOrg = {
  orgUnitId: string;
  orgUnitName: string;
  isPrimary: boolean;
  assignedAt: string;
};

function requireAdmin(actor: ActorContext): void {
  if (!actor.isTenantAdmin) {
    throw new ManagerError('tenant_admin required', 'permission_denied');
  }
}

/** その user が現在管理している org_unit を一覧取得する。 */
export async function listManagedOrgs(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
): Promise<ManagedOrg[]> {
  requireAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      org_unit_id: string;
      org_unit_name: string;
      is_primary: boolean;
      assigned_at: Date;
    }>(
      `SELECT m.org_unit_id, ou.name AS org_unit_name,
              EXISTS (
                SELECT 1 FROM user_org_unit uou
                 WHERE uou.user_id = m.user_id
                   AND uou.org_unit_id = m.org_unit_id
                   AND uou.is_primary = true
              ) AS is_primary,
              m.assigned_at
         FROM org_unit_manager m
         JOIN org_unit ou ON ou.id = m.org_unit_id
        WHERE m.user_id = $1
        ORDER BY is_primary DESC, ou.name ASC`,
      [userId],
    );
    return rows.map((r) => ({
      orgUnitId: r.org_unit_id,
      orgUnitName: r.org_unit_name,
      isPrimary: r.is_primary,
      assignedAt: new Date(r.assigned_at).toISOString(),
    }));
  });
}

/** 任意の org_unit をマネージャ対象に追加する。 */
export async function addManagedOrg(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
  orgUnitId: string,
): Promise<void> {
  requireAdmin(actor);
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: u } = await client.query(
      `SELECT 1 FROM users WHERE id = $1`,
      [userId],
    );
    if (u.length === 0) throw new ManagerError('user not found', 'not_found');
    const { rows: o } = await client.query(
      `SELECT 1 FROM org_unit WHERE id = $1`,
      [orgUnitId],
    );
    if (o.length === 0) throw new ManagerError('org_unit not found', 'not_found');

    await client.query(
      `INSERT INTO org_unit_manager (tenant_id, org_unit_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_unit_id, user_id) DO NOTHING`,
      [actor.tenantId, orgUnitId, userId],
    );
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'org_unit_manager.add', 'user', $3, $4::jsonb)`,
      [actor.tenantId, actor.userId, userId, JSON.stringify({ orgUnitId })],
    );
  });
}

/** 指定 org_unit のマネージャ割当を 1 件解除する。 */
export async function removeManagedOrg(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
  orgUnitId: string,
): Promise<void> {
  requireAdmin(actor);
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `DELETE FROM org_unit_manager
        WHERE user_id = $1 AND org_unit_id = $2`,
      [userId, orgUnitId],
    );
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'org_unit_manager.remove', 'user', $3, $4::jsonb)`,
      [actor.tenantId, actor.userId, userId, JSON.stringify({ orgUnitId })],
    );
  });
}

/**
 * 異動 (主所属変更) に追従して org_unit_manager を更新する。
 *
 * ルール:
 * 1. 当該 user に紐づく org_unit_manager 行を全削除する（手動追加分も含めて全リセット）。
 * 2. user に role='manager' があれば、現在の主所属を新たに org_unit_manager に挿入する。
 *
 * setUserOrgUnits / sync reconciler / setUserRoles から呼ぶ共通関数。
 */
export async function applyTransferToManagerRoles(
  client: pg.PoolClient,
  tenantId: string,
  actorUserId: string | null,
  userId: string,
): Promise<{ wiped: number; reattached: string | null }> {
  const { rows: prev } = await client.query<{ org_unit_id: string }>(
    `SELECT org_unit_id FROM org_unit_manager WHERE user_id = $1`,
    [userId],
  );

  await client.query(
    `DELETE FROM org_unit_manager WHERE user_id = $1`,
    [userId],
  );

  const { rows: roleRows } = await client.query(
    `SELECT 1 FROM user_role WHERE user_id = $1 AND role = 'manager'`,
    [userId],
  );
  const isManager = roleRows.length > 0;

  let reattached: string | null = null;
  if (isManager) {
    const { rows: primaryRows } = await client.query<{ org_unit_id: string }>(
      `SELECT org_unit_id FROM user_org_unit
        WHERE user_id = $1 AND is_primary = true
        LIMIT 1`,
      [userId],
    );
    if (primaryRows.length > 0) {
      reattached = primaryRows[0].org_unit_id;
      await client.query(
        `INSERT INTO org_unit_manager (tenant_id, org_unit_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (org_unit_id, user_id) DO NOTHING`,
        [tenantId, reattached, userId],
      );
    }
  }

  await client.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
     VALUES ($1, $2, 'org_unit_manager.transferred', 'user', $3, $4::jsonb)`,
    [
      tenantId,
      actorUserId,
      userId,
      JSON.stringify({
        wiped: prev.map((p) => p.org_unit_id),
        reattached,
        isManager,
      }),
    ],
  );

  return { wiped: prev.length, reattached };
}
