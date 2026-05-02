import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { setUserOrgUnits, AdminUserError } from '@/domain/admin/users';

export const runtime = 'nodejs';

export async function PUT(
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
  const b = body as { orgUnitIds?: string[]; primaryOrgUnitId?: string | null };
  if (!Array.isArray(b.orgUnitIds)) {
    return NextResponse.json({ error: 'orgUnitIds is required' }, { status: 400 });
  }
  const primary = b.primaryOrgUnitId === undefined ? null : b.primaryOrgUnitId;

  try {
    await setUserOrgUnits(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      id,
      { orgUnitIds: b.orgUnitIds, primaryOrgUnitId: primary },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminUserError) {
      const status = err.code === 'permission_denied' ? 403
        : err.code === 'not_found' ? 404
        : err.code === 'conflict' ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
