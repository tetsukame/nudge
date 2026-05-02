import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { setUserRoles, AdminRoleError } from '@/domain/admin/roles';

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
  const b = body as { roles?: string[] };
  if (!Array.isArray(b.roles)) {
    return NextResponse.json({ error: 'roles is required (string[])' }, { status: 400 });
  }

  try {
    await setUserRoles(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      id,
      b.roles,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AdminRoleError) {
      const status = err.code === 'permission_denied' ? 403
        : err.code === 'not_found' ? 404
        : err.code === 'last_admin' ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
