import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { createRequest, CreateRequestError } from '@/domain/request/create';
import { listRequests, ListRequestsError, type ListScope } from '@/domain/request/list';
import type { TargetSpec } from '@/domain/request/expand-targets';

export const runtime = 'nodejs';

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
  const b = body as {
    title?: string; body?: string; dueAt?: string;
    type?: 'survey' | 'task';
    targets?: unknown[];
  };
  if (!b.title || !b.type || !Array.isArray(b.targets)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    const result = await createRequest(appPool(), guard.actor, {
      title: b.title,
      body: b.body ?? '',
      dueAt: b.dueAt ?? new Date().toISOString(),
      type: b.type,
      targets: b.targets as TargetSpec[],
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CreateRequestError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const url = req.nextUrl;
  const scope = (url.searchParams.get('scope') ?? 'mine') as ListScope;
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '50');
  if (!['mine', 'subordinate', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 });
  }

  try {
    const result = await listRequests(appPool(), guard.actor, { scope, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ListRequestsError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
