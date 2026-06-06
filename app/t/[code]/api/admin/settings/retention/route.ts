import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import {
  getRetentionConfigView,
  upsertRetentionConfig,
  RetentionConfigError,
  type UpsertRetentionConfigInput,
} from '@/domain/retention/config';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  try {
    const view = await getRetentionConfigView(appPool(), guard.actor);
    return NextResponse.json(view);
  } catch (err) {
    if (err instanceof RetentionConfigError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
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
    await upsertRetentionConfig(appPool(), guard.actor, body as UpsertRetentionConfigInput);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RetentionConfigError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
