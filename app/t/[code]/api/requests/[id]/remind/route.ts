import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { mapDomainError } from '@/lib/respond';
import { remindRequest } from '@/domain/request/remind';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  try {
    const result = await remindRequest(appPool(), guard.actor, id);
    return NextResponse.json(result);
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
