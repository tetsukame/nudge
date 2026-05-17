import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import {
  getTenantPositionConfig,
  setTenantPositionConfig,
  PositionConfigError,
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
    if (err instanceof PositionConfigError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
