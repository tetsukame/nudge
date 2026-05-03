import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class AdminOrgError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found' | 'validation' | 'kc_readonly' | 'cycle',
  ) {
    super(message);
    this.name = 'AdminOrgError';
  }
}

export type AdminOrgItem = {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
  status: 'active' | 'archived';
  externalId: string | null; // KC 同期由来かどうか
  archivedAt: string | null;
  memberCount: number;
};

function requireAdmin(actor: ActorContext): void {
  if (!actor.isTenantAdmin) {
    throw new AdminOrgError('tenant_admin required', 'permission_denied');
  }
}

/**
 * テナント全 org_unit を返す（active + archived 両方、admin ビュー用）
 */
export async function listAdminOrgs(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<AdminOrgItem[]> {
  requireAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      parent_id: string | null;
      level: number;
      status: 'active' | 'archived';
      external_id: string | null;
      archived_at: Date | null;
      member_count: number;
    }>(
      `SELECT ou.id, ou.name, ou.parent_id, ou.level, ou.status,
              ou.external_id, ou.archived_at,
              (SELECT COUNT(*)::int FROM user_org_unit uou
                JOIN users u ON u.id = uou.user_id
               WHERE uou.org_unit_id = ou.id AND u.status = 'active') AS member_count
         FROM org_unit ou
        ORDER BY ou.status ASC, ou.level ASC, ou.name ASC`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parent_id,
      level: r.level,
      status: r.status,
      externalId: r.external_id,
      archivedAt: r.archived_at ? new Date(r.archived_at).toISOString() : null,
      memberCount: r.member_count,
    }));
  });
}

export type CreateOrgInput = {
  name: string;
  parentId: string | null;
};

export async function createOrg(
  pool: pg.Pool,
  actor: ActorContext,
  input: CreateOrgInput,
): Promise<{ id: string }> {
  requireAdmin(actor);
  const name = input.name.trim();
  if (!name) throw new AdminOrgError('name required', 'validation');

  return withTenant(pool, actor.tenantId, async (client) => {
    let level = 0;
    if (input.parentId) {
      const { rows } = await client.query<{ level: number; status: string }>(
        `SELECT level, status FROM org_unit WHERE id = $1`,
        [input.parentId],
      );
      if (rows.length === 0) {
        throw new AdminOrgError('parent not found', 'not_found');
      }
      if (rows[0].status !== 'active') {
        throw new AdminOrgError('parent is archived', 'validation');
      }
      level = rows[0].level + 1;
    }

    await client.query('BEGIN');
    try {
      const { rows: insRows } = await client.query<{ id: string }>(
        `INSERT INTO org_unit (tenant_id, name, parent_id, level, external_id, status)
         VALUES ($1, $2, $3, $4, NULL, 'active')
         RETURNING id`,
        [actor.tenantId, name, input.parentId, level],
      );
      const newId = insRows[0].id;

      // closure: self-row
      await client.query(
        `INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
         VALUES ($1, $2, $2, 0)`,
        [actor.tenantId, newId],
      );
      // closure: ancestors of parent + new row as descendant
      if (input.parentId) {
        await client.query(
          `INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
           SELECT $1, c.ancestor_id, $2, c.depth + 1
             FROM org_unit_closure c
            WHERE c.descendant_id = $3`,
          [actor.tenantId, newId, input.parentId],
        );
      }

      await client.query('COMMIT');
      return { id: newId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

async function loadEditable(
  client: pg.PoolClient,
  orgId: string,
): Promise<{ id: string; status: string; external_id: string | null; parent_id: string | null }> {
  const { rows } = await client.query<{
    id: string; status: string; external_id: string | null; parent_id: string | null;
  }>(
    `SELECT id, status, external_id, parent_id FROM org_unit WHERE id = $1`,
    [orgId],
  );
  if (rows.length === 0) {
    throw new AdminOrgError('org not found', 'not_found');
  }
  if (rows[0].external_id !== null) {
    throw new AdminOrgError('keycloak-synced org is read-only in Nudge', 'kc_readonly');
  }
  return rows[0];
}

export async function renameOrg(
  pool: pg.Pool,
  actor: ActorContext,
  orgId: string,
  newName: string,
): Promise<void> {
  requireAdmin(actor);
  const name = newName.trim();
  if (!name) throw new AdminOrgError('name required', 'validation');
  await withTenant(pool, actor.tenantId, async (client) => {
    await loadEditable(client, orgId);
    await client.query(
      `UPDATE org_unit SET name = $1 WHERE id = $2`,
      [name, orgId],
    );
  });
}

/**
 * 親変更（move）。closure を再計算する。external_id IS NULL のみ。
 * 自分の子孫を新親にすると循環するので拒否。
 */
export async function moveOrg(
  pool: pg.Pool,
  actor: ActorContext,
  orgId: string,
  newParentId: string | null,
): Promise<void> {
  requireAdmin(actor);
  await withTenant(pool, actor.tenantId, async (client) => {
    const org = await loadEditable(client, orgId);
    if (newParentId) {
      // 新親が自身 or 子孫 だと循環
      const { rows: cyc } = await client.query<{ ok: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM org_unit_closure
            WHERE ancestor_id = $1 AND descendant_id = $2
         ) AS ok`,
        [orgId, newParentId],
      );
      if (cyc[0].ok) {
        throw new AdminOrgError('new parent is a descendant of this org (cycle)', 'cycle');
      }
      const { rows: parentRows } = await client.query<{ status: string }>(
        `SELECT status FROM org_unit WHERE id = $1`,
        [newParentId],
      );
      if (parentRows.length === 0) {
        throw new AdminOrgError('new parent not found', 'not_found');
      }
      if (parentRows[0].status !== 'active') {
        throw new AdminOrgError('new parent is archived', 'validation');
      }
    }
    if (org.parent_id === newParentId) return;

    await client.query('BEGIN');
    try {
      await client.query(`UPDATE org_unit SET parent_id = $1 WHERE id = $2`, [newParentId, orgId]);
      // 全 closure を rebuild するのが安全 (RECURSIVE で再構築)
      await client.query(`DELETE FROM org_unit_closure WHERE tenant_id = $1`, [actor.tenantId]);
      await client.query(
        `WITH RECURSIVE tree AS (
           SELECT id, id AS ancestor, 0 AS depth FROM org_unit WHERE tenant_id = $1
           UNION ALL
           SELECT o.id, t.ancestor, t.depth + 1
             FROM org_unit o JOIN tree t ON o.parent_id = t.id WHERE o.tenant_id = $1
         )
         INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
         SELECT $1, ancestor, id, depth FROM tree`,
        [actor.tenantId],
      );
      // level 再計算 (ancestor 数 - 1)
      await client.query(
        `UPDATE org_unit ou SET level = sub.depth
           FROM (SELECT descendant_id, MAX(depth) AS depth
                   FROM org_unit_closure
                  WHERE tenant_id = $1
                  GROUP BY descendant_id) sub
          WHERE ou.id = sub.descendant_id AND ou.tenant_id = $1`,
        [actor.tenantId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export type ArchiveResult = { archivedCount: number };

/**
 * org_unit を archive する。配下の active な子孫も全て cascade archive する。
 * external_id IS NOT NULL (KC 同期由来) は対象外。
 * メンバー (user_org_unit) は維持して履歴として残す。
 */
export async function archiveOrg(
  pool: pg.Pool,
  actor: ActorContext,
  orgId: string,
): Promise<ArchiveResult> {
  requireAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    await loadEditable(client, orgId);
    // 子孫 (自身含む) のうち active な org_unit を archived 化
    // KC 同期由来は archive 対象外 (KC 側で削除されたら同期で自動 archive される)
    const { rowCount } = await client.query(
      `UPDATE org_unit
          SET status = 'archived', archived_at = now()
        WHERE id IN (
          SELECT c.descendant_id FROM org_unit_closure c
           WHERE c.ancestor_id = $1
        )
          AND status = 'active'
          AND external_id IS NULL`,
      [orgId],
    );
    return { archivedCount: rowCount ?? 0 };
  });
}

export async function restoreOrg(
  pool: pg.Pool,
  actor: ActorContext,
  orgId: string,
): Promise<void> {
  requireAdmin(actor);
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{ id: string; status: string; external_id: string | null; parent_id: string | null }>(
      `SELECT id, status, external_id, parent_id FROM org_unit WHERE id = $1`,
      [orgId],
    );
    if (rows.length === 0) throw new AdminOrgError('org not found', 'not_found');
    if (rows[0].external_id !== null) {
      // KC 同期由来は KC 側で復活させる必要あり
      throw new AdminOrgError('keycloak-synced org cannot be manually restored', 'kc_readonly');
    }
    if (rows[0].status === 'active') return;
    if (rows[0].parent_id) {
      const { rows: parentRows } = await client.query<{ status: string }>(
        `SELECT status FROM org_unit WHERE id = $1`,
        [rows[0].parent_id],
      );
      if (parentRows.length === 0 || parentRows[0].status !== 'active') {
        throw new AdminOrgError('cannot restore: parent is archived or missing', 'validation');
      }
    }
    await client.query(
      `UPDATE org_unit SET status = 'active', archived_at = NULL WHERE id = $1`,
      [orgId],
    );
  });
}
