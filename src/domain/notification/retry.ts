import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class RetryNotificationError extends Error {
  constructor(message: string, readonly code: 'permission_denied' | 'validation') {
    super(message);
    this.name = 'RetryNotificationError';
  }
}

/**
 * 永続失敗 (next_attempt_at IS NULL かつ status='failed') の通知を pending に戻して
 * worker が次の tick で拾えるようにする。 attempt_count はリセット。
 */
export async function retryNotifications(
  pool: pg.Pool,
  actor: ActorContext,
  ids: string[],
): Promise<{ retried: number }> {
  if (!actor.isTenantAdmin) {
    throw new RetryNotificationError('tenant_admin required', 'permission_denied');
  }
  if (!Array.isArray(ids) || ids.length === 0) return { retried: 0 };

  return withTenant(pool, actor.tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE notification
          SET status = 'pending',
              attempt_count = 0,
              next_attempt_at = NULL,
              scheduled_at = now(),
              last_error = NULL,
              updated_at = now()
        WHERE id = ANY($1::uuid[])
          AND status = 'failed'
          AND next_attempt_at IS NULL`,
      [ids],
    );
    const retried = rowCount ?? 0;
    if (retried > 0) {
      await client.query(
        `INSERT INTO audit_log
           (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
         VALUES ($1, $2, 'notification.retry_requested', 'notification', NULL, $3::jsonb)`,
        [actor.tenantId, actor.userId, JSON.stringify({ ids, retried })],
      );
    }
    return { retried };
  });
}
