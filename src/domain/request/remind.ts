import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import { emitNotification } from '../notification/emit';
import type { ActorContext } from '../types';
import { AUDIT_ACTION } from '../_constants';

export class RemindError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found' | 'rate_limited' | 'no_recipients',
  ) {
    super(message);
    this.name = 'RemindError';
  }
}

export type RemindResult = {
  recipients: number;
};

const MIN_INTERVAL_SECONDS = 3600; // 1 hour

/**
 * 依頼者または tenant_admin が、当該 request の未対応 (unopened/opened) assignment
 * 全件に対して `re_notify` 通知を発火する。
 *
 * レート制限: 同一 request について 1 時間以内の連投は 'rate_limited' で拒否。
 */
export async function remindRequest(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
): Promise<RemindResult> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: reqRows } = await client.query<{
      id: string;
      title: string;
      created_by_user_id: string;
      last_manual_remind_at: Date | null;
    }>(
      `SELECT id, title, created_by_user_id, last_manual_remind_at
         FROM request WHERE id = $1`,
      [requestId],
    );
    if (reqRows.length === 0) {
      throw new RemindError('request not found', 'not_found');
    }
    const req = reqRows[0];

    const isRequester = actor.userId === req.created_by_user_id;
    if (!isRequester && !actor.isTenantAdmin) {
      throw new RemindError(
        'only the requester or tenant_admin can remind',
        'permission_denied',
      );
    }

    if (req.last_manual_remind_at) {
      const elapsed =
        (Date.now() - new Date(req.last_manual_remind_at).getTime()) / 1000;
      if (elapsed < MIN_INTERVAL_SECONDS) {
        throw new RemindError(
          `too soon — last reminder was ${Math.floor(elapsed)}s ago`,
          'rate_limited',
        );
      }
    }

    const { rows: pending } = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM assignment
        WHERE request_id = $1
          AND status IN ('unopened', 'opened')`,
      [requestId],
    );
    if (pending.length === 0) {
      throw new RemindError('no pending assignees', 'no_recipients');
    }

    for (const a of pending) {
      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: a.user_id,
        requestId,
        assignmentId: a.id,
        kind: 're_notify',
        payload: { title: req.title, manual: true },
      });
    }

    await client.query(
      `UPDATE request SET last_manual_remind_at = now() WHERE id = $1`,
      [requestId],
    );

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'request', $4, $5::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        AUDIT_ACTION.REQUEST_MANUAL_REMIND,
        requestId,
        JSON.stringify({ recipients: pending.length }),
      ],
    );

    return { recipients: pending.length };
  });
}
