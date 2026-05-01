import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { removeMember, GroupActionError } from '@/domain/group/actions';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string; userId: string }> },
) {
  const { code, id, userId } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  try {
    await removeMember(appPool(), guard.actor, id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupActionError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
