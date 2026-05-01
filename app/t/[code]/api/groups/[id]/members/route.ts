import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { listMembers, addMembers, GroupActionError } from '@/domain/group/actions';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  try {
    const items = await listMembers(appPool(), guard.actor, id);
    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof GroupActionError) {
      const status = err.code === 'permission_denied' ? 403
        : err.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { userIds?: string[] };
  if (!Array.isArray(b.userIds)) {
    return NextResponse.json({ error: 'userIds required' }, { status: 400 });
  }

  try {
    const result = await addMembers(appPool(), guard.actor, id, b.userIds);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof GroupActionError) {
      const status = err.code === 'permission_denied' || err.code === 'kc_readonly' ? 403
        : err.code === 'not_found' ? 404 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
