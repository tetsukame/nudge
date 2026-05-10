import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import {
  listManagedOrgs,
  addManagedOrg,
  ManagerError,
} from '@/domain/admin/managers';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const items = await listManagedOrgs(
    appPool(),
    { ...guard.actor, isTenantAdmin: true },
    id,
  );
  return NextResponse.json({ items });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { orgUnitId?: string };
  if (!b.orgUnitId) {
    return NextResponse.json({ error: 'orgUnitId is required' }, { status: 400 });
  }

  try {
    await addManagedOrg(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      id,
      b.orgUnitId,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ManagerError) {
      const status = err.code === 'permission_denied' ? 403
        : err.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
