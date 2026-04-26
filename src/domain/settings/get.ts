import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type NotificationSettingsView = {
  smtp: {
    host: string | null;
    port: number | null;
    user: string | null;
    hasPassword: boolean;
    from: string | null;
    secure: boolean;
  };
  teams: { hasWebhookUrl: boolean };
  slack: { hasWebhookUrl: boolean };
  channels: { in_app: boolean; email: boolean; teams: boolean; slack: boolean };
  reminders: {
    reminderBeforeDays: number;
    reNotifyIntervalDays: number;
    reNotifyMaxCount: number;
  };
};

export async function getNotificationSettings(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<NotificationSettingsView> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: settingRows } = await client.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
              smtp_from, smtp_secure,
              teams_webhook_url_encrypted, slack_webhook_url_encrypted,
              reminder_before_days, re_notify_interval_days, re_notify_max_count
         FROM tenant_settings WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const s = settingRows[0];

    const { rows: channelRows } = await client.query<{ channel: string; enabled: boolean }>(
      `SELECT channel, enabled FROM tenant_notification_config
        WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const channels = { in_app: false, email: false, teams: false, slack: false };
    for (const r of channelRows) {
      if (r.channel in channels) {
        (channels as Record<string, boolean>)[r.channel] = r.enabled;
      }
    }

    return {
      smtp: {
        host: s?.smtp_host ?? null,
        port: s?.smtp_port ?? null,
        user: s?.smtp_user ?? null,
        hasPassword: !!s?.smtp_password_encrypted,
        from: s?.smtp_from ?? null,
        secure: s?.smtp_secure ?? false,
      },
      teams: { hasWebhookUrl: !!s?.teams_webhook_url_encrypted },
      slack: { hasWebhookUrl: !!s?.slack_webhook_url_encrypted },
      channels,
      reminders: {
        reminderBeforeDays: s?.reminder_before_days ?? 1,
        reNotifyIntervalDays: s?.re_notify_interval_days ?? 3,
        reNotifyMaxCount: s?.re_notify_max_count ?? 5,
      },
    };
  });
}
