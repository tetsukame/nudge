import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { getGroup } from '@/domain/group/list';
import { updateGroup, deleteGroup, GroupActionError } from '@/domain/group/actions';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const group = await getGroup(appPool(), guard.actor, id);
  if (!group) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json(group);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { name?: string; description?: string | null };

  try {
    await updateGroup(appPool(), guard.actor, id, b);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupActionError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404
        : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  try {
    await deleteGroup(appPool(), guard.actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupActionError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404
        : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
