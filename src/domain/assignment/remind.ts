import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { emitNotification } from '../notification/emit';
import type { ActorContext } from '../types';
import { AUDIT_ACTION } from '../_constants';

export class AssignmentRemindError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'permission_denied'
      | 'not_found'
      | 'rate_limited'
      | 'not_pending',
  ) {
    super(message);
    this.name = 'AssignmentRemindError';
  }
}

export type AssignmentRemindResult = {
  recipientUserId: string;
};

const MIN_INTERVAL_SECONDS = 3600;

/**
 * 単一 assignment に対して `re_notify` 通知を発火する。
 *
 * 認可:
 *  - request の created_by_user_id == actor (依頼者)
 *  - actor が tenant_admin
 *  - actor が assignment.user_id を含む org_unit subtree のいずれかのマネージャ
 *
 * レート制限: 1 assignment あたり 1 時間 1 回 (assignment.last_manual_remind_at)。
 */
export async function remindAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
): Promise<AssignmentRemindResult> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      status: string;
      last_manual_remind_at: Date | null;
      request_id: string;
      title: string;
      created_by_user_id: string;
    }>(
      `SELECT a.id, a.user_id, a.status, a.last_manual_remind_at,
              r.id AS request_id, r.title, r.created_by_user_id
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.id = $1`,
      [assignmentId],
    );
    if (rows.length === 0) {
      throw new AssignmentRemindError('assignment not found', 'not_found');
    }
    const a = rows[0];

    if (!(a.status === 'unopened' || a.status === 'opened')) {
      throw new AssignmentRemindError(
        'assignment is already resolved',
        'not_pending',
      );
    }

    const isRequester = actor.userId === a.created_by_user_id;
    let allowed = isRequester || actor.isTenantAdmin;
    if (!allowed) {
      const { rows: mgr } = await client.query(
        `SELECT 1
           FROM org_unit_manager m
           JOIN org_unit_closure c ON c.ancestor_id = m.org_unit_id
           JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
          WHERE m.user_id = $1 AND uou.user_id = $2
          LIMIT 1`,
        [actor.userId, a.user_id],
      );
      allowed = mgr.length > 0;
    }
    if (!allowed) {
      throw new AssignmentRemindError(
        'only the requester, tenant_admin, or a manager of the assignee can remind',
        'permission_denied',
      );
    }

    if (a.last_manual_remind_at) {
      const elapsed =
        (Date.now() - new Date(a.last_manual_remind_at).getTime()) / 1000;
      if (elapsed < MIN_INTERVAL_SECONDS) {
        throw new AssignmentRemindError(
          `too soon — last reminder was ${Math.floor(elapsed)}s ago`,
          'rate_limited',
        );
      }
    }

    await emitNotification(client, {
      tenantId: actor.tenantId,
      recipientUserId: a.user_id,
      requestId: a.request_id,
      assignmentId: a.id,
      kind: 're_notify',
      payload: { title: a.title, manual: true, scope: 'assignment' },
    });

    await client.query(
      `UPDATE assignment SET last_manual_remind_at = now() WHERE id = $1`,
      [assignmentId],
    );

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'assignment', $4, $5::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        AUDIT_ACTION.ASSIGNMENT_MANUAL_REMIND,
        assignmentId,
        JSON.stringify({ recipientUserId: a.user_id, requestId: a.request_id }),
      ],
    );

    return { recipientUserId: a.user_id };
  });
}
