import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { getNotificationSettings } from '../../../../src/domain/settings/get.js';
import { encryptSecret } from '../../../../src/notification/crypto.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin,
    tenantId: s.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  };
}

describe('getNotificationSettings', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns defaults when no rows exist', async () => {
    const s = await createDomainScenario(getPool());
    const result = await getNotificationSettings(getAppPool(), adminCtx(s));

    expect(result.smtp.host).toBeNull();
    expect(result.smtp.port).toBeNull();
    expect(result.smtp.user).toBeNull();
    expect(result.smtp.hasPassword).toBe(false);
    expect(result.smtp.from).toBeNull();
    expect(result.smtp.secure).toBe(false);
    expect(result.teams.hasWebhookUrl).toBe(false);
    expect(result.slack.hasWebhookUrl).toBe(false);
    expect(result.channels.in_app).toBe(false);
    expect(result.channels.email).toBe(false);
    expect(result.channels.teams).toBe(false);
    expect(result.channels.slack).toBe(false);
    expect(result.reminders.reminderBeforeDays).toBe(1);
    expect(result.reminders.reNotifyIntervalDays).toBe(3);
    expect(result.reminders.reNotifyMaxCount).toBe(5);
  });

  it('masks password and webhook URLs (hasPassword=true, encrypted strings NOT in JSON)', async () => {
    const s = await createDomainScenario(getPool());
    const encPw = encryptSecret('secret-password');
    const encTeams = encryptSecret('https://teams.webhook.example');
    const encSlack = encryptSecret('https://hooks.slack.com/example');

    await getPool().query(
      `INSERT INTO tenant_settings(
         tenant_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
         smtp_from, smtp_secure,
         teams_webhook_url_encrypted, slack_webhook_url_encrypted,
         reminder_before_days, re_notify_interval_days, re_notify_max_count
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [s.tenantId, 'smtp.example.com', 587, 'user@example.com', encPw,
       'from@example.com', true, encTeams, encSlack, 2, 4, 6],
    );

    const result = await getNotificationSettings(getAppPool(), adminCtx(s));

    expect(result.smtp.hasPassword).toBe(true);
    expect(result.teams.hasWebhookUrl).toBe(true);
    expect(result.slack.hasWebhookUrl).toBe(true);

    // Encrypted strings must NOT appear in the returned JSON
    const json = JSON.stringify(result);
    expect(json).not.toContain(encPw);
    expect(json).not.toContain(encTeams);
    expect(json).not.toContain(encSlack);
    expect(json).not.toContain('secret-password');
    expect(json).not.toContain('hooks.slack.com');
  });

  it('reads channel enabled flags from tenant_notification_config', async () => {
    const s = await createDomainScenario(getPool());

    await getPool().query(
      `INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
       VALUES ($1, 'email', true), ($1, 'in_app', true), ($1, 'teams', false), ($1, 'slack', true)`,
      [s.tenantId],
    );

    const result = await getNotificationSettings(getAppPool(), adminCtx(s));

    expect(result.channels.email).toBe(true);
    expect(result.channels.in_app).toBe(true);
    expect(result.channels.teams).toBe(false);
    expect(result.channels.slack).toBe(true);
  });
});
