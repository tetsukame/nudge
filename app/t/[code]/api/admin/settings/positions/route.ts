import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { mapDomainError } from '@/lib/respond';
import { isTenantAdmin } from '@/domain/admin/guard';
import {
  getTenantPositionConfig,
  setTenantPositionConfig,
} from '@/domain/admin/positions';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const result = await getTenantPositionConfig(appPool(), {
    ...guard.actor,
    isTenantAdmin: true,
  });
  return NextResponse.json(result);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const b = body as { managerPositions?: unknown };
  if (!Array.isArray(b.managerPositions)) {
    return NextResponse.json(
      { error: 'managerPositions (string[]) is required' },
      { status: 400 },
    );
  }

  try {
    await setTenantPositionConfig(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      b.managerPositions as string[],
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
