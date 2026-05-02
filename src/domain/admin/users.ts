import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class AdminUserError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found' | 'validation' | 'conflict',
  ) {
    super(message);
    this.name = 'AdminUserError';
  }
}

export type AdminUserListItem = {
  id: string;
  displayName: string;
  email: string;
  status: 'active' | 'inactive';
  primaryOrgUnitName: string | null;
  roles: string[];
  createdAt: string;
};

export type ListAdminUsersInput = {
  orgUnitId: string;       // required (NDG-11 design: must select an org)
  includeDescendants?: boolean; // default true
  q?: string;
  page?: number;
  pageSize?: number;
};

export type ListAdminUsersResult = {
  items: AdminUserListItem[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function requireAdmin(actor: ActorContext): void {
  if (!actor.isTenantAdmin) {
    throw new AdminUserError('tenant_admin required', 'permission_denied');
  }
}

export async function listAdminUsers(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListAdminUsersInput,
): Promise<ListAdminUsersResult> {
  requireAdmin(actor);
  if (!input.orgUnitId) {
    throw new AdminUserError('orgUnitId is required', 'validation');
  }
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;
  const includeDescendants = input.includeDescendants ?? true;

  return withTenant(pool, actor.tenantId, async (client) => {
    // Resolve target org_unit ids (descendants if requested)
    let orgIds: string[];
    if (includeDescendants) {
      const { rows } = await client.query<{ id: string }>(
        `SELECT descendant_id AS id
           FROM org_unit_closure
          WHERE ancestor_id = $1`,
        [input.orgUnitId],
      );
      orgIds = rows.map((r) => r.id);
    } else {
      orgIds = [input.orgUnitId];
    }
    if (orgIds.length === 0) {
      return { items: [], total: 0, page, pageSize };
    }

    const params: unknown[] = [orgIds];
    let qClause = '';
    if (input.q && input.q.trim()) {
      params.push(`%${input.q.trim()}%`);
      qClause = `AND (u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    const baseSql = `
      FROM users u
      WHERE EXISTS (
        SELECT 1 FROM user_org_unit uou
         WHERE uou.user_id = u.id
           AND uou.org_unit_id = ANY($1::uuid[])
      ) ${qClause}
    `;

    const { rows: countRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n ${baseSql}`,
      params,
    );
    const total = parseInt(countRows[0].n, 10);

    params.push(pageSize, offset);
    const { rows } = await client.query<{
      id: string;
      display_name: string;
      email: string;
      status: 'active' | 'inactive';
      primary_org_unit_name: string | null;
      roles: string[];
      created_at: Date;
    }>(
      `SELECT u.id, u.display_name, u.email, u.status,
              (SELECT ou.name FROM user_org_unit uou
                 JOIN org_unit ou ON ou.id = uou.org_unit_id
                WHERE uou.user_id = u.id AND uou.is_primary = true
                LIMIT 1) AS primary_org_unit_name,
              COALESCE(
                (SELECT ARRAY_AGG(r.role) FROM user_role r WHERE r.user_id = u.id),
                ARRAY[]::text[]
              ) AS roles,
              u.created_at
      ${baseSql}
       ORDER BY u.display_name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        email: r.email,
        status: r.status,
        primaryOrgUnitName: r.primary_org_unit_name,
        roles: r.roles ?? [],
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  });
}

export type AdminUserDetail = {
  id: string;
  displayName: string;
  email: string;
  status: 'active' | 'inactive';
  createdAt: string;
  orgUnits: Array<{ id: string; name: string; isPrimary: boolean }>;
  roles: string[];
};

export async function getAdminUser(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
): Promise<AdminUserDetail | null> {
  requireAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: uRows } = await client.query<{
      id: string;
      display_name: string;
      email: string;
      status: 'active' | 'inactive';
      created_at: Date;
    }>(
      `SELECT id, display_name, email, status, created_at
         FROM users WHERE id = $1`,
      [userId],
    );
    if (uRows.length === 0) return null;
    const u = uRows[0];

    const { rows: orgRows } = await client.query<{
      id: string; name: string; is_primary: boolean;
    }>(
      `SELECT ou.id, ou.name, uou.is_primary
         FROM user_org_unit uou
         JOIN org_unit ou ON ou.id = uou.org_unit_id
        WHERE uou.user_id = $1
        ORDER BY uou.is_primary DESC, ou.name ASC`,
      [userId],
    );
    const { rows: roleRows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [userId],
    );
    return {
      id: u.id,
      displayName: u.display_name,
      email: u.email,
      status: u.status,
      createdAt: new Date(u.created_at).toISOString(),
      orgUnits: orgRows.map((r) => ({ id: r.id, name: r.name, isPrimary: r.is_primary })),
      roles: roleRows.map((r) => r.role),
    };
  });
}

export async function setUserStatus(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
  status: 'active' | 'inactive',
): Promise<void> {
  requireAdmin(actor);
  if (userId === actor.userId && status === 'inactive') {
    throw new AdminUserError('cannot deactivate yourself', 'conflict');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE users SET status = $1, updated_at = now() WHERE id = $2`,
      [status, userId],
    );
    if (rowCount === 0) {
      throw new AdminUserError('user not found', 'not_found');
    }
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'admin.user.status_changed', 'user', $3, $4::jsonb)`,
      [actor.tenantId, actor.userId, userId, JSON.stringify({ status })],
    );
  });
}

export type SetOrgUnitsInput = {
  orgUnitIds: string[];      // 全所属 (空なら所属なし)
  primaryOrgUnitId: string | null; // 主所属 (orgUnitIds に含まれる必要あり、空配列なら null 可)
};

export async function setUserOrgUnits(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
  input: SetOrgUnitsInput,
): Promise<void> {
  requireAdmin(actor);
  const ids = [...new Set(input.orgUnitIds)];
  if (input.primaryOrgUnitId !== null && !ids.includes(input.primaryOrgUnitId)) {
    throw new AdminUserError('primaryOrgUnitId must be one of orgUnitIds', 'validation');
  }
  if (ids.length > 0 && input.primaryOrgUnitId === null) {
    throw new AdminUserError('primaryOrgUnitId required when orgUnitIds is non-empty', 'validation');
  }

  await withTenant(pool, actor.tenantId, async (client) => {
    const { rowCount: userExists } = await client.query(
      `SELECT 1 FROM users WHERE id = $1`,
      [userId],
    );
    if (userExists === 0) {
      throw new AdminUserError('user not found', 'not_found');
    }

    await client.query('BEGIN');
    try {
      // Validate all org_unit ids are in the same tenant (RLS already restricts to tenant)
      if (ids.length > 0) {
        const { rows } = await client.query<{ id: string }>(
          `SELECT id FROM org_unit WHERE id = ANY($1::uuid[])`,
          [ids],
        );
        if (rows.length !== ids.length) {
          throw new AdminUserError('one or more org_unit_ids not found', 'validation');
        }
      }

      // Replace strategy: delete all then insert. is_primary unique index keeps invariant.
      await client.query(`DELETE FROM user_org_unit WHERE user_id = $1`, [userId]);
      for (const orgId of ids) {
        await client.query(
          `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary)
           VALUES ($1, $2, $3, $4)`,
          [actor.tenantId, userId, orgId, orgId === input.primaryOrgUnitId],
        );
      }
      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
         VALUES ($1, $2, 'admin.user.org_units_changed', 'user', $3, $4::jsonb)`,
        [
          actor.tenantId, actor.userId, userId,
          JSON.stringify({ orgUnitIds: ids, primaryOrgUnitId: input.primaryOrgUnitId }),
        ],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
