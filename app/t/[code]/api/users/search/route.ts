import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { searchUsers } from '@/domain/user/search';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const q = req.nextUrl.searchParams.get('q') ?? '';
  const orgUnitId = req.nextUrl.searchParams.get('orgUnitId') ?? undefined;
  const limitRaw = Number(req.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(200, Math.floor(limitRaw)) : 20;
  const results = await searchUsers(appPool(), guard.actor, q, limit, { orgUnitId });
  return NextResponse.json(results);
}
