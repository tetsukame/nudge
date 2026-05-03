import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { getRootSession } from '@/auth/root-guard';
import { runSyncForTenant, PlatformSyncError, type SyncMode } from '@/domain/platform/sync';

export const runtime = 'nodejs';

const MODES: ReadonlyArray<SyncMode> = ['full', 'delta', 'full-with-orgs'];

export async function POST(req: NextRequest) {
  const session = await getRootSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { tenantId?: string; mode?: SyncMode };
  if (!b.tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  if (!b.mode || !MODES.includes(b.mode)) {
    return NextResponse.json({ error: `mode must be one of ${MODES.join('|')}` }, { status: 400 });
  }

  try {
    const result = await runSyncForTenant(adminPool(), b.tenantId, b.mode);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PlatformSyncError) {
      return NextResponse.json({ error: err.message, code: err.code },
        { status: err.code === 'not_found' ? 404 : err.code === 'already_running' ? 409 : 400 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
