import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { getAdminUser, setUserStatus, AdminUserError } from '@/domain/admin/users';

export const runtime = 'nodejs';

async function checkAdmin(req: NextRequest, code: string) {
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return guard;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await checkAdmin(req, code);
  if (guard instanceof NextResponse) return guard;

  const detail = await getAdminUser(
    appPool(),
    { ...guard.actor, isTenantAdmin: true },
    id,
  );
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await checkAdmin(req, code);
  if (guard instanceof NextResponse) return guard;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { status?: 'active' | 'inactive' };
  if (b.status !== 'active' && b.status !== 'inactive') {
    return NextResponse.json({ error: 'status must be active|inactive' }, { status: 400 });
  }

  try {
    await setUserStatus(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      id,
      b.status,
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
