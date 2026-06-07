import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../../_lib/session-guard';
import { mapDomainError } from '../../../../_lib/respond';
import { isTenantAdmin } from '@/domain/admin/guard';
import { testSend, type TestSendInput } from '@/domain/settings/test-send';

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

  const b = body as TestSendInput;
  if (!b.channel) {
    return NextResponse.json({ error: 'channel required' }, { status: 400 });
  }

  try {
    const result = await testSend(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      b,
    );
    return NextResponse.json(result);
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
