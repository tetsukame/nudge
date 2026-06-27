import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { removeManagedOrg } from '@/domain/admin/managers';
import { mapDomainError } from '@/lib/respond';

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
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
