import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { listComments } from '@/domain/comment/list';
import { createComment } from '@/domain/comment/create';
import { mapDomainError } from '@/lib/respond';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const result = await listComments(appPool(), guard.actor, id);
  return NextResponse.json(result);
}

export async function POST(
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

  const b = body as { body?: string; assignmentId?: string | null };
  if (!b.body || typeof b.body !== 'string') {
    return NextResponse.json({ error: 'body required' }, { status: 400 });
  }

  try {
    const result = await createComment(appPool(), guard.actor, {
      requestId: id,
      assignmentId: b.assignmentId ?? null,
      body: b.body,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
