import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { retryNotifications, RetryNotificationError } from '@/domain/notification/retry';

export const runtime = 'nodejs';

export async function POST(
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
  const b = body as { ids?: unknown };
  if (!Array.isArray(b.ids) || !b.ids.every((x) => typeof x === 'string')) {
    return NextResponse.json({ error: 'ids: string[] required' }, { status: 400 });
  }

  try {
    const result = await retryNotifications(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      b.ids as string[],
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RetryNotificationError) {
      return NextResponse.json({ error: err.message, code: err.code },
        { status: err.code === 'permission_denied' ? 403 : 400 });
    }
    throw err;
  }
}
