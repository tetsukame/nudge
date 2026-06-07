import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { ROLE } from '../_constants';

/**
 * Returns true if the given user is a tenant_admin in the given tenant.
 * Convenience helper used by /admin pages and API routes.
 */
export async function isTenantAdmin(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM user_role
          WHERE user_id = $1 AND role = $2
       ) AS ok`,
      [userId, ROLE.TENANT_ADMIN],
    );
    return rows[0].ok;
  });
}

/**
 * NDG-67: Returns true if the user can view the audit log.
 * Either tenant_admin or the dedicated auditor role qualifies.
 * Auditor is a read-only role — it does not imply admin privileges.
 */
export async function canViewAuditLog(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM user_role
          WHERE user_id = $1 AND role = ANY($2::text[])
       ) AS ok`,
      [userId, [ROLE.TENANT_ADMIN, ROLE.AUDITOR]],
    );
    return rows[0].ok;
  });
}
