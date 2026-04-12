import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { loadConfig } from '@/config';
import { verifySyncAuth } from '@/sync/api-auth';
import { unsealSession } from '@/auth/session';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
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

  const tenantCode = req.nextUrl.searchParams.get('tenantCode');
  const pool = adminPool();

  let query = `
    SELECT t.code AS tenant_code, sc.enabled, sc.user_source_type,
           sc.last_full_synced_at, sc.last_delta_synced_at, sc.last_error
    FROM tenant t
    JOIN tenant_sync_config sc ON t.id = sc.tenant_id
  `;
  const params: string[] = [];
  if (tenantCode) {
    query += ` WHERE t.code = $1`;
    params.push(tenantCode);
  }

  const { rows: tenants } = await pool.query(query, params);

  const results = [];
  for (const t of tenants) {
    const { rows: logs } = await pool.query(
      `SELECT sync_type, status, started_at, finished_at,
              created_count, updated_count, deactivated_count, reactivated_count, error_message
       FROM sync_log sl
       JOIN tenant ten ON ten.id = sl.tenant_id
       WHERE ten.code = $1
       ORDER BY sl.started_at DESC LIMIT 5`,
      [t.tenant_code],
    );
    results.push({
      tenantCode: t.tenant_code,
      enabled: t.enabled,
      sourceType: t.user_source_type,
      lastFullSync: t.last_full_synced_at,
      lastDeltaSync: t.last_delta_synced_at,
      lastError: t.last_error,
      recentLogs: logs,
    });
  }

  return NextResponse.json({ tenants: results });
}
