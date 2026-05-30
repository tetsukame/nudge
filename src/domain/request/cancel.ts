import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { emitNotification } from '../notification/emit';

export class RequestCancelError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'permission_denied' | 'invalid_state' | 'validation',
  ) {
    super(message);
    this.name = 'RequestCancelError';
  }
}

/**
 * NDG-72: Cancel a request (set status='cancelled').
 *
 * Permission: requester (created_by) OR tenant_admin only.
 *   - Managers are NOT permitted (cancelling a subordinate's received request would be
 *     overreaching — substituteAssignment is the right tool for that).
 * State: only request.status='active' can be cancelled. draft/closed/cancelled all rejected.
 * Side effects:
 *   - Notify every assignee with kind='cancelled' (skip the actor themselves).
 *   - Write `request.cancelled` audit_log entry.
 *   - assignment rows are left as-is; UI greys cancelled requests and disables actions.
 */
export async function cancelRequest(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
  reason: string,
): Promise<void> {
  if (!reason?.trim()) {
    throw new RequestCancelError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: reqRows } = await client.query<{
      id: string;
      created_by_user_id: string;
      status: string;
      title: string;
    }>(
      `SELECT id, created_by_user_id, status, title
         FROM request WHERE id = $1 FOR UPDATE`,
      [requestId],
    );
    if (reqRows.length === 0) {
      throw new RequestCancelError('request not found', 'not_found');
    }
    const r = reqRows[0];
    const isRequester = r.created_by_user_id === actor.userId;
    const isAdmin = actor.isTenantAdmin;
    if (!isRequester && !isAdmin) {
      throw new RequestCancelError('not permitted to cancel', 'permission_denied');
    }
    if (r.status !== 'active') {
      throw new RequestCancelError(
        `cannot cancel from status='${r.status}'`,
        'invalid_state',
      );
    }

    await client.query('BEGIN');
    try {
      await client.query(
        `UPDATE request
            SET status='cancelled',
                cancelled_at=now(),
                cancelled_by_user_id=$2,
                cancel_reason=$3,
                updated_at=now()
          WHERE id=$1`,
        [requestId, actor.userId, reason],
      );

      const { rows: actorRows } = await client.query<{ display_name: string }>(
        `SELECT display_name FROM users WHERE id=$1`,
        [actor.userId],
      );
      const cancelledBy = actorRows[0]?.display_name ?? '依頼者';

      // Notify every assignee except the actor (if they happen to be on the recipient list).
      const { rows: assignees } = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM assignment WHERE request_id=$1 AND user_id <> $2`,
        [requestId, actor.userId],
      );
      for (const a of assignees) {
        await emitNotification(client, {
          tenantId: actor.tenantId,
          recipientUserId: a.user_id,
          requestId: r.id,
          assignmentId: a.id,
          kind: 'cancelled',
          payload: {
            title: r.title,
            cancelledBy,
            reason,
          },
        });
      }

      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
         VALUES ($1, $2, 'request.cancelled', 'request', $3, $4::jsonb)`,
        [
          actor.tenantId, actor.userId, requestId,
          JSON.stringify({
            actorRole: isAdmin && !isRequester ? 'tenant_admin' : 'requester',
            reason,
            assigneeCount: assignees.length,
          }),
        ],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
