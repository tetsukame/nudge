import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { listSubordinateMatrix } from '@/domain/request/subordinate-matrix';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const url = new URL(req.url);
  const filterParam = url.searchParams.get('filter');
  const filter =
    filterParam === 'all' || filterParam === 'done' ? filterParam : 'in_progress';
  const q = url.searchParams.get('q') ?? undefined;
  const orgUnitId = url.searchParams.get('orgUnitId') ?? undefined;
  const overdueOnly = url.searchParams.get('overdue') === '1';
  const dueWithinDaysRaw = url.searchParams.get('dueWithinDays');
  const dueWithinDays = dueWithinDaysRaw
    ? Math.max(1, Math.min(90, Number(dueWithinDaysRaw) || 0))
    : undefined;

  const result = await listSubordinateMatrix(appPool(), guard.actor, {
    filter,
    q,
    orgUnitId,
    overdueOnly,
    dueWithinDays,
  });
  return NextResponse.json(result);
}
