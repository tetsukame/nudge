import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { encryptSecret } from '../../notification/crypto';

export class SettingsUpdateError extends Error {
  constructor(msg: string, readonly code: 'permission_denied' | 'validation') {
    super(msg);
    this.name = 'SettingsUpdateError';
  }
}

export type UpdateSettingsInput = {
  smtp: {
    host?: string | null;
    port?: number | null;
    user?: string | null;
    password?: string;
    from?: string | null;
    secure?: boolean;
  };
  teams: { webhookUrl?: string };
  slack: { webhookUrl?: string };
  channels: { in_app: boolean; email: boolean; teams: boolean; slack: boolean };
  reminders: {
    reminderBeforeDays: number;
    reNotifyIntervalDays: number;
    reNotifyMaxCount: number;
  };
};

const ALL_CHANNELS = ['in_app', 'email', 'teams', 'slack'] as const;

export async function updateNotificationSettings(
  pool: pg.Pool,
  actor: ActorContext,
  input: UpdateSettingsInput,
): Promise<void> {
  if (!actor.isTenantAdmin) {
    throw new SettingsUpdateError('tenant_admin required', 'permission_denied');
  }

  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: existingRows } = await client.query(
      `SELECT smtp_password_encrypted, teams_webhook_url_encrypted,
              slack_webhook_url_encrypted
         FROM tenant_settings WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const existing = existingRows[0];

    const smtpPasswordEncrypted = input.smtp.password !== undefined
      ? encryptSecret(input.smtp.password)
      : (existing?.smtp_password_encrypted ?? null);

    const teamsWebhookEncrypted = input.teams.webhookUrl !== undefined
      ? encryptSecret(input.teams.webhookUrl)
      : (existing?.teams_webhook_url_encrypted ?? null);

    const slackWebhookEncrypted = input.slack.webhookUrl !== undefined
      ? encryptSecret(input.slack.webhookUrl)
      : (existing?.slack_webhook_url_encrypted ?? null);

    await client.query(
      `INSERT INTO tenant_settings(
         tenant_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
         smtp_from, smtp_secure,
         teams_webhook_url_encrypted, slack_webhook_url_encrypted,
         reminder_before_days, re_notify_interval_days, re_notify_max_count
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         smtp_user = EXCLUDED.smtp_user,
         smtp_password_encrypted = EXCLUDED.smtp_password_encrypted,
         smtp_from = EXCLUDED.smtp_from,
         smtp_secure = EXCLUDED.smtp_secure,
         teams_webhook_url_encrypted = EXCLUDED.teams_webhook_url_encrypted,
         slack_webhook_url_encrypted = EXCLUDED.slack_webhook_url_encrypted,
         reminder_before_days = EXCLUDED.reminder_before_days,
         re_notify_interval_days = EXCLUDED.re_notify_interval_days,
         re_notify_max_count = EXCLUDED.re_notify_max_count,
         updated_at = now()`,
      [
        actor.tenantId,
        input.smtp.host ?? null,
        input.smtp.port ?? null,
        input.smtp.user ?? null,
        smtpPasswordEncrypted,
        input.smtp.from ?? null,
        input.smtp.secure ?? false,
        teamsWebhookEncrypted,
        slackWebhookEncrypted,
        input.reminders.reminderBeforeDays,
        input.reminders.reNotifyIntervalDays,
        input.reminders.reNotifyMaxCount,
      ],
    );

    for (const ch of ALL_CHANNELS) {
      const enabled = input.channels[ch];
      await client.query(
        `INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, channel) DO UPDATE
            SET enabled = EXCLUDED.enabled, updated_at = now()`,
        [actor.tenantId, ch, enabled],
      );
    }
  });
}
