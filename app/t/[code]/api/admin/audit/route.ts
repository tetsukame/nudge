import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { canViewAuditLog } from '@/domain/admin/guard';
import { listAuditLog, exportAuditLogCsv, AuditLogError } from '@/domain/audit-log/list';

export const runtime = 'nodejs';

function parseInt1(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  // NDG-67: tenant_admin or auditor
  const ok = await canViewAuditLog(appPool(), guard.actor.tenantId, guard.actor.userId);
  if (!ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const url = req.nextUrl;
  const input = {
    actorUserId: url.searchParams.get('actor') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    targetType: url.searchParams.get('targetType') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  };

  try {
    if (url.searchParams.get('format') === 'csv') {
      const result = await exportAuditLogCsv(appPool(), guard.actor, input);
      const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      return new NextResponse(result.csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Audit-Row-Count': String(result.rowCount),
          'X-Audit-Truncated': String(result.truncated),
        },
      });
    }

    const result = await listAuditLog(appPool(), guard.actor, {
      ...input,
      page: parseInt1(url.searchParams.get('page'), 1),
      pageSize: parseInt1(url.searchParams.get('pageSize'), 50),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuditLogError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'permission_denied' ? 403 : 400 },
      );
    }
    throw err;
  }
}
