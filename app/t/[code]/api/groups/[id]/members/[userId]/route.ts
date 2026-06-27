import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { removeMember } from '@/domain/group/actions';
import { mapDomainError } from '@/lib/respond';

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
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
