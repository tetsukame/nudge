import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { removeManagedOrg, ManagerError } from '@/domain/admin/managers';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string; orgUnitId: string }> },
) {
  const { code, id, orgUnitId } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    await removeManagedOrg(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      id,
      orgUnitId,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ManagerError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
