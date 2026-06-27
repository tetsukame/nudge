import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { mapDomainError } from '@/lib/respond';
import {
  listTemplates,
  createTemplate,
} from '@/domain/template/template';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  const items = await listTemplates(appPool(), guard.actor);
  return NextResponse.json({ items });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  try {
    const created = await createTemplate(appPool(), guard.actor, {
      orgUnitId: String(b.orgUnitId ?? ''),
      title: String(b.title ?? ''),
      body: typeof b.body === 'string' ? b.body : null,
      estimatedMinutes: typeof b.estimatedMinutes === 'number' ? b.estimatedMinutes : null,
      defaultDueOffsetDays:
        typeof b.defaultDueOffsetDays === 'number' ? b.defaultDueOffsetDays : null,
      defaultTargets: Array.isArray(b.defaultTargets)
        ? b.defaultTargets as never
        : [],
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const r = mapDomainError(err);
    if (r) return r;
    throw err;
  }
}
