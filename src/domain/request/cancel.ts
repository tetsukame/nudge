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
 * NDG-72 / NDG-79: Cancel a request (set status='cancelled').
 *
 * Permission: requester (created_by) OR tenant_admin only.
 *   - Managers are NOT permitted (cancelling a subordinate's received request would be
 *     overreaching — substituteAssignment is the right tool for that).
 * State:
 *   - status='active' → 通常キャンセル。受信者全員に kind='cancelled' を通知し、
 *     audit_log は action='request.cancelled'。
 *   - status='draft' AND scheduled_at IS NOT NULL → 予約取り消し。まだ誰にも通知
 *     していないので通知発火なし。audit_log は action='request.scheduled_cancelled'。
 *     reason 未指定時は '予約取り消し' を既定。
 *   - その他 (closed/cancelled/通常 draft 等) は拒否。
 */
export async function cancelRequest(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
  reason: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: reqRows } = await client.query<{
      id: string;
      created_by_user_id: string;
      status: string;
      title: string;
      scheduled_at: Date | null;
    }>(
      `SELECT id, created_by_user_id, status, title, scheduled_at
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

    const isScheduledCancel = r.status === 'draft' && r.scheduled_at != null;
    if (r.status !== 'active' && !isScheduledCancel) {
      throw new RequestCancelError(
        `cannot cancel from status='${r.status}'`,
        'invalid_state',
      );
    }

    const effectiveReason = reason?.trim()
      ? reason.trim()
      : isScheduledCancel ? '予約取り消し' : '';
    if (!effectiveReason) {
      throw new RequestCancelError('reason required', 'validation');
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
        [requestId, actor.userId, effectiveReason],
      );

      let assigneeCount = 0;
      if (!isScheduledCancel) {
        const { rows: actorRows } = await client.query<{ display_name: string }>(
          `SELECT display_name FROM users WHERE id=$1`,
          [actor.userId],
        );
        const cancelledBy = actorRows[0]?.display_name ?? '依頼者';

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
              reason: effectiveReason,
            },
          });
        }
        assigneeCount = assignees.length;
      }

      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
         VALUES ($1, $2, $3, 'request', $4, $5::jsonb)`,
        [
          actor.tenantId, actor.userId,
          isScheduledCancel ? 'request.scheduled_cancelled' : 'request.cancelled',
          requestId,
          JSON.stringify({
            actorRole: isAdmin && !isRequester ? 'tenant_admin' : 'requester',
            reason: effectiveReason,
            assigneeCount,
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
