import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import {
  getAIConfigView,
  upsertAIConfig,
  AIConfigError,
  type UpsertAIConfigInput,
} from '@/domain/ai/config';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  try {
    const view = await getAIConfigView(appPool(), guard.actor);
    return NextResponse.json(view ?? null);
  } catch (err) {
    if (err instanceof AIConfigError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
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
    await upsertAIConfig(appPool(), guard.actor, body as UpsertAIConfigInput);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AIConfigError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
