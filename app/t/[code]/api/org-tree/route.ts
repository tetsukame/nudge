import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { getOrgTree } from '@/domain/org/tree';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const tree = await getOrgTree(appPool(), guard.actor);
  return NextResponse.json(tree);
}
