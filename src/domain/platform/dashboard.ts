import type pg from 'pg';

export type PlatformStats = {
  tenants: { active: number; suspended: number; total: number };
  totalUsers: number; // active across all tenants
  syncEnabledTenants: number;
  syncRunningCount: number;
  syncFailedRecentCount: number; // last 24h
};

export async function getPlatformStats(pool: pg.Pool): Promise<PlatformStats> {
  const { rows } = await pool.query<{
    tenants_active: string;
    tenants_suspended: string;
    total_users: string;
    sync_enabled: string;
    sync_running: string;
    sync_failed_24h: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM tenant WHERE status = 'active') AS tenants_active,
       (SELECT COUNT(*)::text FROM tenant WHERE status = 'suspended') AS tenants_suspended,
       (SELECT COUNT(*)::text FROM users WHERE status = 'active') AS total_users,
       (SELECT COUNT(*)::text FROM tenant_sync_config WHERE enabled = true) AS sync_enabled,
       (SELECT COUNT(*)::text FROM sync_log WHERE status = 'running') AS sync_running,
       (SELECT COUNT(*)::text FROM sync_log
         WHERE status = 'failed' AND started_at > now() - interval '24 hours') AS sync_failed_24h`,
  );
  const r = rows[0];
  const active = parseInt(r.tenants_active, 10);
  const suspended = parseInt(r.tenants_suspended, 10);
  return {
    tenants: { active, suspended, total: active + suspended },
    totalUsers: parseInt(r.total_users, 10),
    syncEnabledTenants: parseInt(r.sync_enabled, 10),
    syncRunningCount: parseInt(r.sync_running, 10),
    syncFailedRecentCount: parseInt(r.sync_failed_24h, 10),
  };
}
