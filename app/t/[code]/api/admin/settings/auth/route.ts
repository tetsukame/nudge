import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { mapDomainError } from '@/lib/respond';
import {
  getTenantAuthConfigView,
  upsertTenantAuthConfig,
  deleteTenantAuthConfig,
  type UpsertTenantAuthConfigInput,
} from '@/domain/auth/config';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  try {
    const view = await getTenantAuthConfigView(appPool(), guard.actor);
    return NextResponse.json(view ?? null);
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
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
    await upsertTenantAuthConfig(
      appPool(),
      guard.actor,
      body as UpsertTenantAuthConfigInput,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  try {
    await deleteTenantAuthConfig(appPool(), guard.actor);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
