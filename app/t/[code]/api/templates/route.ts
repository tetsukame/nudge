import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { listTemplates } from '@/domain/template/template';

export const runtime = 'nodejs';

/**
 * NDG-68: end-user-facing list of templates the actor can use
 * (for prefill in the new request form). Returns the same payload as the
 * admin list endpoint — the admin endpoint exists separately so that future
 * admin-only filters (archived, all-tenant) can diverge.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const items = await listTemplates(appPool(), guard.actor);
  return NextResponse.json({ items });
}
