import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { listFailedNotifications, FailedNotificationError } from '@/domain/notification/list-failed';

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
  const page = parseInt1(url.searchParams.get('page'), 1);
  const pageSize = parseInt1(url.searchParams.get('pageSize'), 50);

  try {
    const result = await listFailedNotifications(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      page, pageSize,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FailedNotificationError) {
      return NextResponse.json({ error: err.message, code: err.code },
        { status: err.code === 'permission_denied' ? 403 : 400 });
    }
    throw err;
  }
}
