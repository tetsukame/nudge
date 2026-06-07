import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { mapDomainError } from '../../_lib/respond';
import { cancelRequest } from '@/domain/request/cancel';
import { getRequestDetail } from '@/domain/request/get-detail';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  try {
    const detail = await getRequestDetail(appPool(), guard.actor, id);
    return NextResponse.json(detail);
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as { action?: string; reason?: string };

  if (b.action !== 'cancel') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  try {
    await cancelRequest(appPool(), guard.actor, id, b.reason ?? '');
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
