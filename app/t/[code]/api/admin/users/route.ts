import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { listAdminUsers, AdminUserError } from '@/domain/admin/users';

export const runtime = 'nodejs';

function parseInt1(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const ok = await isTenantAdmin(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = req.nextUrl;
  const orgUnitId = url.searchParams.get('orgUnitId');
  if (!orgUnitId) {
    return NextResponse.json({ error: 'orgUnitId is required' }, { status: 400 });
  }
  const q = url.searchParams.get('q') ?? undefined;
  const page = parseInt1(url.searchParams.get('page'), 1);
  const pageSize = parseInt1(url.searchParams.get('pageSize'), 50);
  const includeDescendants = url.searchParams.get('includeDescendants') !== 'false';

  try {
    const result = await listAdminUsers(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      { orgUnitId, q, page, pageSize, includeDescendants },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AdminUserError) {
      return NextResponse.json({ error: err.message, code: err.code },
        { status: err.code === 'permission_denied' ? 403 : 400 });
    }
    throw err;
  }
}
