import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class AdminRoleError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'validation' | 'last_admin' | 'not_found',
  ) {
    super(message);
    this.name = 'AdminRoleError';
  }
}

export type AssignableRole = 'tenant_admin' | 'tenant_wide_requester';
const ASSIGNABLE: ReadonlySet<string> = new Set(['tenant_admin', 'tenant_wide_requester']);

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
    const willHaveAdmin = requested.includes('tenant_admin');
    if (!willHaveAdmin) {
      const { rows: adminRows } = await client.query<{ user_id: string }>(
        `SELECT user_id FROM user_role WHERE role = 'tenant_admin'`,
      );
      const remaining = adminRows.filter((r) => r.user_id !== userId);
      if (remaining.length === 0) {
        throw new AdminRoleError(
          'cannot remove tenant_admin from the last admin in this tenant',
          'last_admin',
        );
      }
    }

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
         VALUES ($1, $2, 'admin.user.roles_changed', 'user', $3, $4::jsonb)`,
        [actor.tenantId, actor.userId, userId, JSON.stringify({ roles: requested })],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
