import pg from 'pg';
import { withTenant } from '../db/with-tenant';
import type { SyncSource, SyncResult } from './types';

export async function reconcileUsers(
  appPool: pg.Pool,
  adminPool: pg.Pool,
  tenantId: string,
  source: SyncSource,
  mode: 'full' | 'delta',
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, deactivated: 0, reactivated: 0 };

  if (mode === 'full') {
    const seenIds = new Set<string>();

    for await (const chunk of source.fetchAllUsers()) {
      await withTenant(appPool, tenantId, async (client) => {
        for (const user of chunk) {
          seenIds.add(user.externalId);
          const status = user.active ? 'active' : 'inactive';
          const { rows } = await client.query<{ action: string }>(
            `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, keycloak_sub)
             DO UPDATE SET
               email = EXCLUDED.email,
               display_name = EXCLUDED.display_name,
               status = EXCLUDED.status,
               updated_at = now()
             WHERE users.email != EXCLUDED.email
                OR users.display_name != EXCLUDED.display_name
                OR users.status != EXCLUDED.status
             RETURNING
               CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
            [tenantId, user.externalId, user.email, user.displayName, status],
          );
          if (rows.length === 0) continue;
          if (rows[0].action === 'created') result.created++;
          else result.updated++;
        }
      });
    }

    // Deactivate users not in KC (using adminPool to see all tenant users)
    const deactivated = await deactivateMissing(adminPool, tenantId, seenIds);
    result.deactivated = deactivated;
  } else {
    if (!source.fetchDeltaUsers) {
      throw new Error('SyncSource does not support delta sync');
    }
    const since = await getLastDeltaSyncTime(adminPool, tenantId);
    const users = await source.fetchDeltaUsers(since);

    await withTenant(appPool, tenantId, async (client) => {
      for (const user of users) {
        const status = user.active ? 'active' : 'inactive';
        const { rows } = await client.query<{ action: string }>(
          `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, keycloak_sub)
           DO UPDATE SET
             email = EXCLUDED.email,
             display_name = EXCLUDED.display_name,
             status = EXCLUDED.status,
             updated_at = now()
           WHERE users.email != EXCLUDED.email
              OR users.display_name != EXCLUDED.display_name
              OR users.status != EXCLUDED.status
           RETURNING
             CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
          [tenantId, user.externalId, user.email, user.displayName, status],
        );
        if (rows.length === 0) continue;
        if (rows[0].action === 'created') result.created++;
        else result.updated++;
      }
    });
  }

  return result;
}

async function deactivateMissing(
  adminPool: pg.Pool,
  tenantId: string,
  seenIds: Set<string>,
): Promise<number> {
  const { rows } = await adminPool.query<{ keycloak_sub: string }>(
    `SELECT keycloak_sub FROM users WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId],
  );
  const toDeactivate = rows
    .filter((r) => !seenIds.has(r.keycloak_sub))
    .map((r) => r.keycloak_sub);

  if (toDeactivate.length === 0) return 0;

  const { rowCount } = await adminPool.query(
    `UPDATE users SET status = 'inactive', updated_at = now()
     WHERE tenant_id = $1 AND keycloak_sub = ANY($2::text[]) AND status = 'active'`,
    [tenantId, toDeactivate],
  );
  return rowCount ?? 0;
}

async function getLastDeltaSyncTime(
  adminPool: pg.Pool,
  tenantId: string,
): Promise<Date> {
  const { rows } = await adminPool.query<{ last_delta_synced_at: Date | null }>(
    `SELECT last_delta_synced_at FROM tenant_sync_config WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows[0]?.last_delta_synced_at) {
    return rows[0].last_delta_synced_at;
  }
  return new Date(Date.now() - 60 * 60 * 1000);
}
