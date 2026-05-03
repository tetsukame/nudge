import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { archiveOrg, restoreOrg, AdminOrgError } from '@/domain/admin/orgs';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const result = await archiveOrg(appPool(), { ...guard.actor, isTenantAdmin: true }, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AdminOrgError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  // restore (reverse of archive). DELETE method used for symmetry with archive=POST.
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    await restoreOrg(appPool(), { ...guard.actor, isTenantAdmin: true }, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminOrgError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
