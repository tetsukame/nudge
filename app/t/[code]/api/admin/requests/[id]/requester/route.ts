import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import {
  reassignRequester,
  ReassignRequesterError,
} from '@/domain/request/reassign-requester';

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
  const b = body as { userId?: string };
  if (!b.userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const result = await reassignRequester(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      id,
      b.userId,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ReassignRequesterError) {
      const status =
        err.code === 'permission_denied' ? 403
        : err.code === 'not_found' ? 404
        : err.code === 'invalid_target' ? 422
        : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
