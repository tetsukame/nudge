import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { renameOrg, moveOrg, AdminOrgError } from '@/domain/admin/orgs';

export const runtime = 'nodejs';

export async function PATCH(
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
  const b = body as { name?: string; parentId?: string | null };

  try {
    if (b.name !== undefined) {
      await renameOrg(appPool(), { ...guard.actor, isTenantAdmin: true }, id, b.name);
    }
    if (b.parentId !== undefined) {
      await moveOrg(appPool(), { ...guard.actor, isTenantAdmin: true }, id, b.parentId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminOrgError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404
        : err.code === 'cycle' ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
