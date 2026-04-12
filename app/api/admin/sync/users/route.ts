import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { loadConfig } from '@/config';
import { verifySyncAuth } from '@/sync/api-auth';
import { reconcileUsers } from '@/sync/reconciler';
import { KeycloakSyncSource } from '@/sync/keycloak-source';
import { unsealSession } from '@/auth/session';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const cfg = loadConfig();

  const authHeader = req.headers.get('authorization');
  const sealed = req.cookies.get('nudge_session')?.value;
  const session = sealed ? await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD) : null;

  let sessionRoles: string[] = [];
  if (session) {
    const { rows } = await adminPool().query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    sessionRoles = rows.map((r) => r.role);
  }

  const auth = verifySyncAuth(authHeader, session ? { roles: sessionRoles } : null, cfg.SYNC_API_KEY);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  let body: { tenantCode?: string; mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is OK
  }
  const mode = (body.mode === 'full' ? 'full' : 'delta') as 'full' | 'delta';

  const pool = adminPool();
  let tenants: { id: string; code: string; keycloak_issuer_url: string }[];

  if (body.tenantCode) {
    const { rows } = await pool.query(
      `SELECT t.id, t.code, t.keycloak_issuer_url
       FROM tenant t JOIN tenant_sync_config sc ON t.id = sc.tenant_id
       WHERE t.code = $1 AND sc.enabled = true`,
      [body.tenantCode],
    );
    tenants = rows;
  } else {
    const { rows } = await pool.query(
      `SELECT t.id, t.code, t.keycloak_issuer_url
       FROM tenant t JOIN tenant_sync_config sc ON t.id = sc.tenant_id
       WHERE sc.enabled = true`,
    );
    tenants = rows;
  }

  const results = [];

  for (const tenant of tenants) {
    const { rows: running } = await pool.query(
      `SELECT 1 FROM sync_log WHERE tenant_id = $1 AND status = 'running' LIMIT 1`,
      [tenant.id],
    );
    if (running.length > 0) {
      results.push({ tenantCode: tenant.code, skipped: true, reason: 'sync already running' });
      continue;
    }

    const { rows: configRows } = await pool.query<{
      sync_client_id: string;
      sync_client_secret: string;
    }>(
      `SELECT sync_client_id, sync_client_secret FROM tenant_sync_config WHERE tenant_id = $1`,
      [tenant.id],
    );
    if (!configRows[0]?.sync_client_id || !configRows[0]?.sync_client_secret) {
      results.push({ tenantCode: tenant.code, skipped: true, reason: 'sync credentials not configured' });
      continue;
    }

    const logId = (await pool.query<{ id: string }>(
      `INSERT INTO sync_log (tenant_id, sync_type, source_type)
       VALUES ($1, $2, 'keycloak') RETURNING id`,
      [tenant.id, mode],
    )).rows[0].id;

    const startTime = Date.now();
    try {
      const source = new KeycloakSyncSource(
        tenant.keycloak_issuer_url,
        configRows[0].sync_client_id,
        configRows[0].sync_client_secret,
      );

      const syncResult = await reconcileUsers(appPool(), pool, tenant.id, source, mode);

      await pool.query(
        `UPDATE sync_log SET status = 'success', finished_at = now(),
         created_count = $2, updated_count = $3, deactivated_count = $4, reactivated_count = $5
         WHERE id = $1`,
        [logId, syncResult.created, syncResult.updated, syncResult.deactivated, syncResult.reactivated],
      );

      const tsField = mode === 'full' ? 'last_full_synced_at' : 'last_delta_synced_at';
      await pool.query(
        `UPDATE tenant_sync_config SET ${tsField} = now(), last_error = NULL, updated_at = now()
         WHERE tenant_id = $1`,
        [tenant.id],
      );

      results.push({
        tenantCode: tenant.code,
        syncType: mode,
        ...syncResult,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE sync_log SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1`,
        [logId, errorMessage],
      );
      await pool.query(
        `UPDATE tenant_sync_config SET last_error = $2, updated_at = now() WHERE tenant_id = $1`,
        [tenant.id, errorMessage],
      );
      results.push({ tenantCode: tenant.code, error: errorMessage });
    }
  }

  return NextResponse.json({ results });
}
