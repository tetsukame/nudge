import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class RequestDetailError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'permission_denied',
  ) {
    super(message);
    this.name = 'RequestDetailError';
  }
}

export type RequestDetailMyAssignment = {
  id: string;
  status: string;
  isOverdue: boolean;
};

export type RequestDetail = {
  id: string;
  title: string;
  body: string;
  status: string;
  dueAt: Date | null;
  createdAt: Date;
  createdByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  myAssignment: RequestDetailMyAssignment | null;
};

/**
 * NDG-93 (A2 E7): 依頼詳細の取得。
 *
 * 以前は app/t/[code]/api/requests/[id]/route.ts GET に ~70 行の SQL +
 * 4 種類の権限チェックロジックが直書きされていた。これを domain helper
 * に集約し、route は session-guard → 呼び出し → mapDomainError のみに
 * なるようにする。
 *
 * 権限: 以下のいずれかに該当する actor のみ閲覧可
 *  1. 依頼作成者 (created_by_user_id == actor.userId)
 *  2. 受信者 (assignment が紐づく)
 *  3. tenant_admin / tenant_wide_requester
 *  4. 受信者の主所属 (またはその祖先 org_unit) のマネージャ
 *
 * 該当しなければ `RequestDetailError('forbidden', 'permission_denied')`。
 * 依頼自体が存在しなければ `RequestDetailError('not_found')`。
 */
export async function getRequestDetail(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
): Promise<RequestDetail> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: reqRows } = await client.query<{
      id: string;
      title: string;
      body: string;
      status: string;
      due_at: Date | null;
      created_at: Date;
      created_by_user_id: string | null;
      cancelled_at: Date | null;
      cancelled_by_user_id: string | null;
      cancel_reason: string | null;
      cancelled_by_name: string | null;
    }>(
      `SELECT r.id, r.title, r.body, r.status, r.due_at, r.created_at, r.created_by_user_id,
              r.cancelled_at, r.cancelled_by_user_id, r.cancel_reason,
              cu.display_name AS cancelled_by_name
         FROM request r
         LEFT JOIN users cu ON cu.id = r.cancelled_by_user_id
        WHERE r.id=$1`,
      [requestId],
    );
    if (reqRows.length === 0) {
      throw new RequestDetailError('request not found', 'not_found');
    }
    const r = reqRows[0];

    const isCreator = r.created_by_user_id === actor.userId;
    const { rows: asgSelf } = await client.query<{ id: string }>(
      `SELECT id FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [requestId, actor.userId],
    );
    const isAssignee = asgSelf.length > 0;
    const isWide = actor.isTenantAdmin || actor.isTenantWideRequester;
    let isSubordinateManager = false;
    if (!isCreator && !isAssignee && !isWide) {
      const { rows: mgr } = await client.query(
        `SELECT 1 FROM assignment a
           JOIN user_org_unit uou ON uou.user_id = a.user_id
           JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
           JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
          WHERE a.request_id=$1 AND m.user_id=$2 LIMIT 1`,
        [requestId, actor.userId],
      );
      isSubordinateManager = mgr.length > 0;
    }
    if (!(isCreator || isAssignee || isWide || isSubordinateManager)) {
      throw new RequestDetailError('forbidden', 'permission_denied');
    }

    let myAssignment: RequestDetailMyAssignment | null = null;
    if (asgSelf.length > 0) {
      const { rows } = await client.query<{
        id: string; status: string; overdue: boolean;
      }>(
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

    return {
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      dueAt: r.due_at,
      createdAt: r.created_at,
      createdByUserId: r.created_by_user_id,
      cancelledAt: r.cancelled_at,
      cancelledByUserId: r.cancelled_by_user_id,
      cancelledByName: r.cancelled_by_name,
      cancelReason: r.cancel_reason,
      myAssignment,
    };
  });
}
