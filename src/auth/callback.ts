import pg from 'pg';
import { withTenant } from '../db/with-tenant';

export type JitUserInfo = {
  sub: string;
  email: string;
  displayName: string;
};

/**
 * Upsert a user row based on Keycloak id_token claims and return users.id.
 * Runs inside withTenant so RLS / tenant isolation is enforced.
 */
export async function jitUpsertUser(
  pool: pg.Pool,
  tenantId: string,
  info: JitUserInfo,
): Promise<string> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, keycloak_sub)
       DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         updated_at = now()
       RETURNING id`,
      [tenantId, info.sub, info.email, info.displayName],
    );
    return rows[0].id;
  });
}
