import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import {
  remindAssignment,
  AssignmentRemindError,
} from '@/domain/assignment/remind';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  try {
    const result = await remindAssignment(appPool(), guard.actor, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AssignmentRemindError) {
      const status =
        err.code === 'not_found' ? 404
        : err.code === 'permission_denied' ? 403
        : err.code === 'rate_limited' ? 429
        : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
