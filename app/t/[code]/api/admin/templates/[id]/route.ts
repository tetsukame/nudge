import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import {
  getTemplate,
  updateTemplate,
  archiveTemplate,
  TemplateError,
} from '@/domain/template/template';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  try {
    const t = await getTemplate(appPool(), guard.actor, id);
    return NextResponse.json(t);
  } catch (err) {
    if (err instanceof TemplateError) {
      const status =
        err.code === 'not_found' ? 404 :
        err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  try {
    await updateTemplate(appPool(), guard.actor, id, {
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TemplateError) {
      const status =
        err.code === 'not_found' ? 404 :
        err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  try {
    await archiveTemplate(appPool(), guard.actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof TemplateError) {
      const status =
        err.code === 'not_found' ? 404 :
        err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
