import type pg from 'pg';
import { getChannel } from '../notification/channel-registry';
import type { TenantSettings } from '../notification/types';
import type { NotificationContext } from '../notification/channel';

const BATCH_SIZE = 100;

type PendingRow = {
  id: string;
  tenant_id: string;
  request_id: string | null;
  assignment_id: string | null;
  recipient_user_id: string;
  channel: string;
  kind: NotificationContext['kind'];
  payload_json: Record<string, unknown>;
};

type RecipientRow = {
  email: string;
  display_name: string;
};

const DEFAULT_SETTINGS = (tenantId: string): TenantSettings => ({
  tenantId,
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPasswordEncrypted: null,
  smtpFrom: null,
  smtpSecure: false,
  reminderBeforeDays: 1,
  reNotifyIntervalDays: 3,
  reNotifyMaxCount: 5,
  updatedAt: new Date(),
});

async function loadSettings(client: pg.PoolClient, tenantId: string): Promise<TenantSettings> {
  const { rows } = await client.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
            smtp_from, smtp_secure, reminder_before_days,
            re_notify_interval_days, re_notify_max_count, updated_at
       FROM tenant_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) return DEFAULT_SETTINGS(tenantId);
  const r = rows[0];
  return {
    tenantId,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpUser: r.smtp_user,
    smtpPasswordEncrypted: r.smtp_password_encrypted,
    smtpFrom: r.smtp_from,
    smtpSecure: r.smtp_secure,
    reminderBeforeDays: r.reminder_before_days,
    reNotifyIntervalDays: r.re_notify_interval_days,
    reNotifyMaxCount: r.re_notify_max_count,
    updatedAt: r.updated_at,
  };
}

async function loadRecipient(client: pg.PoolClient, userId: string): Promise<RecipientRow | null> {
  const { rows } = await client.query<RecipientRow>(
    `SELECT email, display_name FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function runSender(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<PendingRow>(
      `SELECT id, tenant_id, request_id, assignment_id, recipient_user_id,
              channel, kind, payload_json
         FROM notification
        WHERE status='pending' AND scheduled_at <= now()
        ORDER BY scheduled_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      try {
        const channel = getChannel(row.channel);
        if (!channel) {
          throw new Error(`unknown channel: ${row.channel}`);
        }
        const recipient = await loadRecipient(client, row.recipient_user_id);
        if (!recipient) {
          throw new Error(`recipient not found: ${row.recipient_user_id}`);
        }
        const settings = await loadSettings(client, row.tenant_id);
        const ctx: NotificationContext = {
          notificationId: row.id,
          tenantId: row.tenant_id,
          requestId: row.request_id,
          assignmentId: row.assignment_id,
          recipientUserId: row.recipient_user_id,
          recipientEmail: recipient.email,
          recipientName: recipient.display_name,
          kind: row.kind,
          payload: row.payload_json,
        };
        await channel.send(ctx, settings);
        await client.query(
          `UPDATE notification SET status='sent', sent_at=now() WHERE id=$1`,
          [row.id],
        );
      } catch (err) {
        await client.query(
          `UPDATE notification
              SET status='failed',
                  attempt_count = attempt_count + 1,
                  error_message = $2
            WHERE id = $1`,
          [row.id, (err as Error).message],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
