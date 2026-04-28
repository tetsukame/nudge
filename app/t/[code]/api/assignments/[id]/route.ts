import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import {
  openAssignment,
  respondAssignment,
  notNeededAssignment,
  forwardAssignment,
  substituteAssignment,
  exemptAssignment,
  AssignmentActionError,
} from '@/domain/assignment/actions';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as {
    action?: string;
    toUserId?: string;
    reason?: string;
    note?: string;
  };
  if (!b.action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 });
  }

  try {
    let payload: unknown = { ok: true };
    switch (b.action) {
      case 'open':
        await openAssignment(appPool(), guard.actor, id); break;
      case 'respond':
        await respondAssignment(appPool(), guard.actor, id, { note: b.note }); break;
      case 'not_needed':
        await notNeededAssignment(appPool(), guard.actor, id, { reason: b.reason ?? '' }); break;
      case 'forward':
        if (!b.toUserId) {
          return NextResponse.json({ error: 'toUserId required' }, { status: 400 });
        }
        payload = await forwardAssignment(
          appPool(), guard.actor, id,
          { toUserId: b.toUserId, reason: b.reason },
        );
        break;
      case 'substitute':
        await substituteAssignment(appPool(), guard.actor, id, { reason: b.reason ?? '' }); break;
      case 'exempt':
        await exemptAssignment(appPool(), guard.actor, id, { reason: b.reason ?? '' }); break;
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof AssignmentActionError) {
      const status =
        err.code === 'not_found' ? 404 :
        err.code === 'permission_denied' ? 403 :
        err.code === 'conflict' ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
