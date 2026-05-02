import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import type { TenantSettings } from '../../notification/types';
import { encryptSecret } from '../../notification/crypto';
import { ChannelError } from '../../notification/channel';
import { EmailChannel } from '../../notification/channels/email';
import { TeamsChannel } from '../../notification/channels/teams';
import { SlackChannel } from '../../notification/channels/slack';

export class TestSendError extends Error {
  constructor(message: string, readonly code: 'permission_denied' | 'validation') {
    super(message);
    this.name = 'TestSendError';
  }
}

export type TestSendChannel = 'email' | 'teams' | 'slack';

export type TestSendInput = {
  channel: TestSendChannel;
  smtp?: {
    host?: string | null;
    port?: number | null;
    user?: string | null;
    password?: string; // when present (incl. ''), use form value; absent = use saved
    from?: string | null;
    secure?: boolean;
  };
  teams?: { webhookUrl?: string }; // when present, use form value; absent = use saved
  slack?: { webhookUrl?: string };
};

export type TestSendResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * テスト送信。フォームの現在値で 1 回だけ送信し、tenant_settings は変更しない（NDG-2 B 案）。
 * 未送信のフィールド (password / webhookUrl) は保存値にフォールバックする。
 */
export async function testSend(
  pool: pg.Pool,
  actor: ActorContext,
  input: TestSendInput,
): Promise<TestSendResult> {
  if (!actor.isTenantAdmin) {
    throw new TestSendError('tenant_admin required', 'permission_denied');
  }
  if (!['email', 'teams', 'slack'].includes(input.channel)) {
    throw new TestSendError(`unknown channel: ${input.channel}`, 'validation');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    // 既存設定を取得（保存値フォールバック用）
    const { rows: settingsRows } = await client.query<{
      smtp_host: string | null;
      smtp_port: number | null;
      smtp_user: string | null;
      smtp_password_encrypted: string | null;
      smtp_from: string | null;
      smtp_secure: boolean;
      teams_webhook_url_encrypted: string | null;
      slack_webhook_url_encrypted: string | null;
    }>(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
              smtp_from, smtp_secure,
              teams_webhook_url_encrypted, slack_webhook_url_encrypted
         FROM tenant_settings WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const saved = settingsRows[0];

    // actor のメール / 表示名（メール送信の宛先 + 表示用）
    const { rows: actorRows } = await client.query<{ email: string; display_name: string }>(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [actor.userId],
    );
    if (actorRows.length === 0) {
      throw new TestSendError('actor user not found', 'validation');
    }
    const recipientEmail = actorRows[0].email;
    const recipientName = actorRows[0].display_name;

    // フォーム + saved を合成して TenantSettings を作る
    const settings: TenantSettings = {
      tenantId: actor.tenantId,
      smtpHost: input.smtp?.host ?? saved?.smtp_host ?? null,
      smtpPort: input.smtp?.port ?? saved?.smtp_port ?? null,
      smtpUser: input.smtp?.user ?? saved?.smtp_user ?? null,
      smtpPasswordEncrypted:
        input.smtp?.password === undefined
          ? saved?.smtp_password_encrypted ?? null
          : input.smtp.password === ''
            ? null
            : encryptSecret(input.smtp.password),
      smtpFrom: input.smtp?.from ?? saved?.smtp_from ?? null,
      smtpSecure: input.smtp?.secure ?? saved?.smtp_secure ?? false,
      teamsWebhookUrlEncrypted:
        input.teams?.webhookUrl === undefined
          ? saved?.teams_webhook_url_encrypted ?? null
          : input.teams.webhookUrl === ''
            ? null
            : encryptSecret(input.teams.webhookUrl),
      slackWebhookUrlEncrypted:
        input.slack?.webhookUrl === undefined
          ? saved?.slack_webhook_url_encrypted ?? null
          : input.slack.webhookUrl === ''
            ? null
            : encryptSecret(input.slack.webhookUrl),
      reminderBeforeDays: 0,
      reNotifyIntervalDays: 0,
      reNotifyMaxCount: 0,
    };

    const ch =
      input.channel === 'email' ? new EmailChannel()
      : input.channel === 'teams' ? new TeamsChannel()
      : new SlackChannel();

    try {
      await ch.send(
        {
          notificationId: 'test-send',
          tenantId: actor.tenantId,
          requestId: null,
          assignmentId: null,
          recipientUserId: actor.userId,
          recipientEmail,
          recipientName,
          kind: 'created',
          payload: {
            title: '[テスト送信] Nudge 通知設定の動作確認',
            isTestSend: true,
          },
        },
        settings,
      );
      return { ok: true };
    } catch (err) {
      if (err instanceof ChannelError) {
        return { ok: false, error: err.message };
      }
      return { ok: false, error: (err as Error).message ?? 'unknown error' };
    }
  });
}
