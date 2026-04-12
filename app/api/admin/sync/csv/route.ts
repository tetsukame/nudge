import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { loadConfig } from '@/config';
import { verifySyncAuth } from '@/sync/api-auth';
import { unsealSession } from '@/auth/session';
import { CsvSyncSource } from '@/sync/csv-source';
import { reconcileUsers } from '@/sync/reconciler';
import { reconcileOrgs } from '@/sync/org-reconciler';

export const runtime = 'nodejs';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const cfg = loadConfig();

  // Auth
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

  // Parse multipart form data
  const formData = await req.formData();
  const file = formData.get('file');
  const tenantCode = formData.get('tenantCode') as string | null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!tenantCode) {
    return NextResponse.json({ error: 'tenantCode is required' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 });
  }

  // Resolve tenant
  const pool = adminPool();
  const { rows: tenantRows } = await pool.query(
    `SELECT id FROM tenant WHERE code = $1`,
    [tenantCode],
  );
  if (tenantRows.length === 0) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenantId = tenantRows[0].id;

  // Read file content
  const buffer = Buffer.from(await file.arrayBuffer());
  const csvContent = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.toString('utf-8')
    : buffer.toString('utf-8');

  // Parse
  let source: CsvSyncSource;
  try {
    source = new CsvSyncSource(csvContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Create sync_log
  const logId = (await pool.query<{ id: string }>(
    `INSERT INTO sync_log (tenant_id, sync_type, source_type)
     VALUES ($1, 'full', 'csv') RETURNING id`,
    [tenantId],
  )).rows[0].id;

  try {
    const orgResult = await reconcileOrgs(pool, tenantId, source);
    const userResult = await reconcileUsers(appPool(), pool, tenantId, source, 'full');

    await pool.query(
      `UPDATE sync_log SET status = 'success', finished_at = now(),
       created_count = $2, updated_count = $3, deactivated_count = $4
       WHERE id = $1`,
      [logId, userResult.created, userResult.updated, userResult.deactivated],
    );

    return NextResponse.json({ users: userResult, orgs: orgResult });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE sync_log SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1`,
      [logId, errorMessage],
    );
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
