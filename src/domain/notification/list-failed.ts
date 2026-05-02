import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class FailedNotificationError extends Error {
  constructor(message: string, readonly code: 'permission_denied') {
    super(message);
    this.name = 'FailedNotificationError';
  }
}

export type FailedNotificationItem = {
  id: string;
  channel: string;
  kind: string;
  recipientUserId: string;
  recipientName: string | null;
  recipientEmail: string | null;
  requestId: string | null;
  requestTitle: string | null;
  attemptCount: number;
  lastError: string | null;
  failedAt: string;
};

export type ListFailedNotificationsResult = {
  items: FailedNotificationItem[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function listFailedNotifications(
  pool: pg.Pool,
  actor: ActorContext,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<ListFailedNotificationsResult> {
  if (!actor.isTenantAdmin) {
    throw new FailedNotificationError('tenant_admin required', 'permission_denied');
  }
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
  const offset = (safePage - 1) * safePageSize;

  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: countRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM notification
        WHERE status = 'failed' AND next_attempt_at IS NULL`,
    );
    const total = parseInt(countRows[0].n, 10);

    const { rows } = await client.query<{
      id: string;
      channel: string;
      kind: string;
      recipient_user_id: string;
      recipient_name: string | null;
      recipient_email: string | null;
      request_id: string | null;
      request_title: string | null;
      attempt_count: number;
      last_error: string | null;
      updated_at: Date;
    }>(
      `SELECT n.id, n.channel, n.kind, n.recipient_user_id,
              u.display_name AS recipient_name, u.email AS recipient_email,
              n.request_id, r.title AS request_title,
              n.attempt_count, n.last_error, n.updated_at
         FROM notification n
         LEFT JOIN users u ON u.id = n.recipient_user_id
         LEFT JOIN request r ON r.id = n.request_id
        WHERE n.status = 'failed' AND n.next_attempt_at IS NULL
        ORDER BY n.updated_at DESC
        LIMIT $1 OFFSET $2`,
      [safePageSize, offset],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        kind: r.kind,
        recipientUserId: r.recipient_user_id,
        recipientName: r.recipient_name,
        recipientEmail: r.recipient_email,
        requestId: r.request_id,
        requestTitle: r.request_title,
        attemptCount: r.attempt_count,
        lastError: r.last_error,
        failedAt: new Date(r.updated_at).toISOString(),
      })),
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  });
}
