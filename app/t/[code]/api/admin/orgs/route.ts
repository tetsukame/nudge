import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { isTenantAdmin } from '@/domain/admin/guard';
import { listAdminOrgs, createOrg, AdminOrgError } from '@/domain/admin/orgs';

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

  const items = await listAdminOrgs(appPool(), { ...guard.actor, isTenantAdmin: true });
  return NextResponse.json({ items });
}

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
  const b = body as { name?: string; parentId?: string | null };
  if (!b.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  try {
    const result = await createOrg(
      appPool(),
      { ...guard.actor, isTenantAdmin: true },
      { name: b.name, parentId: b.parentId ?? null },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AdminOrgError) {
      return NextResponse.json({ error: err.message, code: err.code },
        { status: err.code === 'permission_denied' ? 403
            : err.code === 'not_found' ? 404 : 400 });
    }
    throw err;
  }
}
