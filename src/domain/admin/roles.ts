import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { applyTransferToManagerRoles } from './managers';
import { ASSIGNABLE_ROLES, AUDIT_ACTION, ROLE, type Role } from '../_constants';

export class AdminRoleError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'validation' | 'last_admin' | 'not_found',
  ) {
    super(message);
    this.name = 'AdminRoleError';
  }
}

export type AssignableRole = Exclude<Role, typeof ROLE.PLATFORM_ADMIN>;
const ASSIGNABLE: ReadonlySet<string> = new Set(ASSIGNABLE_ROLES);

export async function setUserRoles(
  pool: pg.Pool,
  actor: ActorContext,
  userId: string,
  roles: string[],
): Promise<void> {
  if (!actor.isTenantAdmin) {
    throw new AdminRoleError('tenant_admin required', 'permission_denied');
  }

  // Validate roles list
  const requested = [...new Set(roles)];
  for (const r of requested) {
    if (!ASSIGNABLE.has(r)) {
      throw new AdminRoleError(`unknown role: ${r}`, 'validation');
    }
  }

  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: u } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1`,
      [userId],
    );
    if (u.length === 0) {
      throw new AdminRoleError('user not found', 'not_found');
    }

    // 安全策: 最後の tenant_admin を奪う動きを拒否
    const willHaveAdmin = requested.includes(ROLE.TENANT_ADMIN);
    if (!willHaveAdmin) {
      const { rows: adminRows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM user_role WHERE role = $1`,
        [ROLE.TENANT_ADMIN],
      );
      const remaining = adminRows.filter((r) => r.user_id !== userId);
      if (remaining.length === 0) {
        throw new AdminRoleError(
          'cannot remove tenant_admin from the last admin in this tenant',
          'last_admin',
        );
      }
    }

    // Detect a change in the manager role so we can update org_unit_manager accordingly.
    const { rows: priorRoleRows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1 AND role = ANY($2::text[])`,
      [userId, [...ASSIGNABLE]],
    );
    const wasManager = priorRoleRows.some((r) => r.role === ROLE.MANAGER);
    const willBeManager = requested.includes(ROLE.MANAGER);
    const managerToggled = wasManager !== willBeManager;

    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM user_role WHERE user_id = $1 AND role = ANY($2::text[])`,
        [userId, [...ASSIGNABLE]],
      );
      for (const role of requested) {
        await client.query(
          `INSERT INTO user_role (tenant_id, user_id, role) VALUES ($1, $2, $3)`,
          [actor.tenantId, userId, role],
        );
      }
      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
         VALUES ($1, $2, $3, 'user', $4, $5::jsonb)`,
        [actor.tenantId, actor.userId, AUDIT_ACTION.ADMIN_USER_ROLES_CHANGED, userId, JSON.stringify({ roles: requested })],
      );
      if (managerToggled) {
        // NDG-48: a manual toggle locks the user out of KC position sync so
        // an admin override is not silently reverted on the next sync.
        await client.query(
          `UPDATE users SET manager_source = 'manual' WHERE id = $1`,
          [userId],
        );
        // Wipe + re-apply (will INSERT primary if role is now manager; will leave empty otherwise).
        await applyTransferToManagerRoles(
          client, actor.tenantId, actor.userId, userId,
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
