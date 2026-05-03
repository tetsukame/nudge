import type pg from 'pg';
import { reconcileUsers } from '../../sync/reconciler';
import { reconcileOrgs } from '../../sync/org-reconciler';
import { KeycloakSyncSource } from '../../sync/keycloak-source';
import { appPool } from '../../db/pools';

export class PlatformSyncError extends Error {
  constructor(message: string, readonly code: 'not_configured' | 'not_found' | 'already_running' | 'validation') {
    super(message);
    this.name = 'PlatformSyncError';
  }
}

export type SyncMode = 'full' | 'delta' | 'full-with-orgs';

export type SyncRunResult = {
  tenantCode: string;
  syncType: SyncMode;
  created: number;
  updated: number;
  deactivated: number;
  reactivated: number;
  orgs?: { created: number; updated: number; removed: number; membershipsUpdated: number };
  durationMs: number;
};

/**
 * Run a Keycloak sync for the given tenant. Records sync_log along the way.
 * Designed to be called from /root/sync (root admin only).
 */
export async function runSyncForTenant(
  pool: pg.Pool,
  tenantId: string,
  mode: SyncMode,
): Promise<SyncRunResult> {
  // 1. Load tenant + sync config
  const { rows: tRows } = await pool.query<{
    code: string;
    keycloak_issuer_url: string;
    enabled: boolean | null;
    sync_client_id: string | null;
    sync_client_secret: string | null;
    org_source_type: string | null;
    org_group_prefix: string | null;
  }>(
    `SELECT t.code, t.keycloak_issuer_url,
            sc.enabled, sc.sync_client_id, sc.sync_client_secret,
            sc.org_source_type, sc.org_group_prefix
       FROM tenant t
       LEFT JOIN tenant_sync_config sc ON sc.tenant_id = t.id
      WHERE t.id = $1`,
    [tenantId],
  );
  if (tRows.length === 0) {
    throw new PlatformSyncError('tenant not found', 'not_found');
  }
  const t = tRows[0];
  if (!t.enabled) {
    throw new PlatformSyncError('sync is not enabled for this tenant', 'not_configured');
  }
  if (!t.sync_client_id || !t.sync_client_secret) {
    throw new PlatformSyncError('sync_client_id / sync_client_secret not configured', 'not_configured');
  }

  // 2. Check if a run is already in progress
  const { rows: running } = await pool.query(
    `SELECT 1 FROM sync_log WHERE tenant_id = $1 AND status = 'running' LIMIT 1`,
    [tenantId],
  );
  if (running.length > 0) {
    throw new PlatformSyncError('a sync is already running for this tenant', 'already_running');
  }

  // 3. Create sync_log row
  const { rows: logRows } = await pool.query<{ id: string }>(
    `INSERT INTO sync_log (tenant_id, sync_type, source_type)
     VALUES ($1, $2, 'keycloak') RETURNING id`,
    [tenantId, mode],
  );
  const logId = logRows[0].id;

  const start = Date.now();
  try {
    const source = new KeycloakSyncSource(
      t.keycloak_issuer_url,
      t.sync_client_id,
      t.sync_client_secret,
    );

    let orgs: SyncRunResult['orgs'];
    if (mode === 'full-with-orgs' && t.org_source_type === 'keycloak' && t.org_group_prefix) {
      source.setOrgGroupPrefix(t.org_group_prefix);
      orgs = await reconcileOrgs(pool, tenantId, source);
    }

    const userMode: 'full' | 'delta' = mode === 'full-with-orgs' ? 'full' : mode;
    const userRes = await reconcileUsers(appPool(), pool, tenantId, source, userMode);

    await pool.query(
      `UPDATE sync_log SET status = 'success', finished_at = now(),
        created_count = $2, updated_count = $3,
        deactivated_count = $4, reactivated_count = $5
        WHERE id = $1`,
      [logId, userRes.created, userRes.updated, userRes.deactivated, userRes.reactivated],
    );

    const tsField = mode === 'delta' ? 'last_delta_synced_at' : 'last_full_synced_at';
    await pool.query(
      `UPDATE tenant_sync_config SET ${tsField} = now(), last_error = NULL, updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId],
    );

    return {
      tenantCode: t.code, syncType: mode,
      ...userRes,
      ...(orgs ? { orgs } : {}),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE sync_log SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1`,
      [logId, msg],
    );
    await pool.query(
      `UPDATE tenant_sync_config SET last_error = $2, updated_at = now() WHERE tenant_id = $1`,
      [tenantId, msg],
    );
    throw err;
  }
}

export type SyncLogItem = {
  id: string;
  tenantCode: string;
  tenantName: string;
  syncType: string;
  sourceType: string;
  status: string;
  createdCount: number;
  updatedCount: number;
  deactivatedCount: number;
  reactivatedCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export async function listSyncLog(pool: pg.Pool, limit = 100): Promise<SyncLogItem[]> {
  const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
  const { rows } = await pool.query<{
    id: string;
    tenant_code: string;
    tenant_name: string;
    sync_type: string;
    source_type: string;
    status: string;
    created_count: number | null;
    updated_count: number | null;
    deactivated_count: number | null;
    reactivated_count: number | null;
    started_at: Date;
    finished_at: Date | null;
    error_message: string | null;
  }>(
    `SELECT sl.id, t.code AS tenant_code, t.name AS tenant_name,
            sl.sync_type, sl.source_type, sl.status,
            sl.created_count, sl.updated_count,
            sl.deactivated_count, sl.reactivated_count,
            sl.started_at, sl.finished_at, sl.error_message
       FROM sync_log sl
       JOIN tenant t ON t.id = sl.tenant_id
      ORDER BY sl.started_at DESC
      LIMIT $1`,
    [safeLimit],
  );
  return rows.map((r) => ({
    id: r.id,
    tenantCode: r.tenant_code,
    tenantName: r.tenant_name,
    syncType: r.sync_type,
    sourceType: r.source_type,
    status: r.status,
    createdCount: r.created_count ?? 0,
    updatedCount: r.updated_count ?? 0,
    deactivatedCount: r.deactivated_count ?? 0,
    reactivatedCount: r.reactivated_count ?? 0,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    errorMessage: r.error_message,
  }));
}
