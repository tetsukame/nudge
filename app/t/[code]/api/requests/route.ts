import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { createRequest, CreateRequestError } from '@/domain/request/create';
import { listRequests, ListRequestsError, type ListScope } from '@/domain/request/list';
import { listSentRequests } from '@/domain/request/list-sent';
import type { TargetSpec } from '@/domain/request/expand-targets';

export const runtime = 'nodejs';

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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
  const b = body as {
    title?: string; body?: string; dueAt?: string;
    estimatedMinutes?: number;
    senderOrgUnitId?: string | null;
    targets?: unknown[];
  };
  if (!b.title || !Array.isArray(b.targets)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    const result = await createRequest(appPool(), guard.actor, {
      title: b.title,
      body: b.body ?? '',
      dueAt: b.dueAt ?? new Date().toISOString(),
      estimatedMinutes: b.estimatedMinutes,
      senderOrgUnitId: b.senderOrgUnitId,
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
  const scope = url.searchParams.get('scope') ?? 'mine';
  const page = parsePositiveInt(url.searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 50);

  if (scope === 'sent') {
    const filter = (url.searchParams.get('filter') ?? undefined) as 'all' | 'in_progress' | 'done' | undefined;
    const q = url.searchParams.get('q') ?? undefined;
    const result = await listSentRequests(appPool(), guard.actor, { filter, q, page, pageSize });
    return NextResponse.json(result);
  }

  if (!['mine', 'subordinate', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 });
  }

  try {
    const result = await listRequests(appPool(), guard.actor, { scope: scope as ListScope, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ListRequestsError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
