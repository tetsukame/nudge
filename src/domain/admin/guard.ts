import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';

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
          WHERE user_id = $1 AND role = 'tenant_admin'
       ) AS ok`,
      [userId],
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
          WHERE user_id = $1 AND role IN ('tenant_admin', 'auditor')
       ) AS ok`,
      [userId],
    );
    return rows[0].ok;
  });
}
