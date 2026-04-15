import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { withTenant } from '@/db/with-tenant';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const statusFilter = req.nextUrl.searchParams.get('status') ?? 'pending';
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') ?? '50')));

  const statusSql =
    statusFilter === 'done'
      ? `a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')`
      : `a.status IN ('unopened','opened')`;

  return withTenant(appPool(), guard.tenantId, async (client) => {
    const { rows: countRows } = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.user_id = $1 AND ${statusSql}`,
      [guard.actor.userId],
    );
    const total = countRows[0].n;
    const { rows } = await client.query(
      `SELECT a.id, a.status, a.opened_at, a.responded_at, a.action_at,
              r.id AS request_id, r.title, r.due_at,
              (r.due_at IS NOT NULL AND r.due_at < now()
               AND a.status IN ('unopened','opened')) AS is_overdue
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.user_id = $1 AND ${statusSql}
        ORDER BY r.due_at ASC NULLS LAST, a.created_at DESC
        LIMIT $2 OFFSET $3`,
      [guard.actor.userId, pageSize, (page - 1) * pageSize],
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        openedAt: r.opened_at,
        respondedAt: r.responded_at,
        actionAt: r.action_at,
        request: { id: r.request_id, title: r.title, dueAt: r.due_at },
        isOverdue: r.is_overdue,
      })),
      total, page, pageSize,
    });
  });
}
