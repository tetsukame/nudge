import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { getNotificationSettings } from '@/domain/settings/get';
import {
  updateNotificationSettings,
  SettingsUpdateError,
  type UpdateSettingsInput,
} from '@/domain/settings/update';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  if (!guard.actor.isTenantAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await getNotificationSettings(appPool(), guard.actor);
  return NextResponse.json(result);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    await updateNotificationSettings(appPool(), guard.actor, body as UpdateSettingsInput);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SettingsUpdateError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
