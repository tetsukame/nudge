import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { listGroups } from '@/domain/group/list';
import { createGroup, GroupActionError } from '@/domain/group/actions';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const items = await listGroups(appPool(), guard.actor);
  return NextResponse.json({ items });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as { name?: string; description?: string };
  try {
    const result = await createGroup(appPool(), guard.actor, {
      name: b.name ?? '',
      description: b.description,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof GroupActionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'permission_denied' ? 403 : 400 },
      );
    }
    throw err;
  }
}
