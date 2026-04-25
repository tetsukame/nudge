import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { listAssignees, AssigneesError } from '@/domain/request/assignees';
import type { AssignmentStatus } from '@/domain/types';

export const runtime = 'nodejs';

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const url = req.nextUrl;
  const q = url.searchParams.get('q') ?? undefined;
  const orgUnitId = url.searchParams.get('orgUnitId') ?? undefined;
  const includeDescendants = url.searchParams.get('includeDescendants') === 'true';
  const groupId = url.searchParams.get('groupId') ?? undefined;
  const statusParam = url.searchParams.get('status');
  const statuses = statusParam ? (statusParam.split(',') as AssignmentStatus[]) : undefined;
  const hasUnreadParam = url.searchParams.get('hasUnread');
  const hasUnread = hasUnreadParam === 'true' ? true : undefined;
  const page = parsePositiveInt(url.searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 50);

  try {
    const result = await listAssignees(appPool(), guard.actor, id, {
      q, orgUnitId, includeDescendants, groupId, statuses, hasUnread, page, pageSize,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AssigneesError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
