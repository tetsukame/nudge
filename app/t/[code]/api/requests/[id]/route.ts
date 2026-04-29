import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { withTenant } from '@/db/with-tenant';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  return withTenant(appPool(), guard.tenantId, async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT id, title, body, status, due_at, created_at, created_by_user_id
         FROM request WHERE id=$1`,
      [id],
    );
    if (reqRows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const r = reqRows[0];

    const isCreator = r.created_by_user_id === guard.actor.userId;
    const { rows: asgSelf } = await client.query(
      `SELECT id FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [id, guard.actor.userId],
    );
    const isAssignee = asgSelf.length > 0;
    const isWide = guard.actor.isTenantAdmin || guard.actor.isTenantWideRequester;
    let isSubordinateManager = false;
    if (!isCreator && !isAssignee && !isWide) {
      const { rows: mgr } = await client.query(
        `SELECT 1 FROM assignment a
           JOIN user_org_unit uou ON uou.user_id = a.user_id
           JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
           JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
          WHERE a.request_id=$1 AND m.user_id=$2 LIMIT 1`,
        [id, guard.actor.userId],
      );
      isSubordinateManager = mgr.length > 0;
    }
    if (!(isCreator || isAssignee || isWide || isSubordinateManager)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    let myAssignment: { id: string; status: string; isOverdue: boolean } | null = null;
    if (asgSelf.length > 0) {
      const { rows } = await client.query(
        `SELECT a.id, a.status, (r.due_at IS NOT NULL AND r.due_at < now()
                                 AND a.status IN ('unopened','opened')) AS overdue
           FROM assignment a JOIN request r ON r.id = a.request_id
          WHERE a.id=$1`,
        [asgSelf[0].id],
      );
      myAssignment = {
        id: rows[0].id,
        status: rows[0].status,
        isOverdue: rows[0].overdue,
      };
    }

    return NextResponse.json({
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      dueAt: r.due_at,
      createdAt: r.created_at,
      createdByUserId: r.created_by_user_id,
      myAssignment,
    });
  });
}
