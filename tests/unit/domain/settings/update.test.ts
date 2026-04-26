import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { updateNotificationSettings, SettingsUpdateError } from '../../../../src/domain/settings/update.js';
import { getNotificationSettings } from '../../../../src/domain/settings/get.js';
import { decryptSecret, encryptSecret } from '../../../../src/notification/crypto.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin,
    tenantId: s.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  };
}

function nonAdminCtx(s: { tenantId: string; users: { memberA: string } }): ActorContext {
  return {
    userId: s.users.memberA,
    tenantId: s.tenantId,
    isTenantAdmin: false,
    isTenantWideRequester: false,
  };
}

const defaultInput = {
  smtp: { host: null, port: null, user: null, from: null, secure: false },
  teams: {},
  slack: {},
  channels: { in_app: false, email: false, teams: false, slack: false },
  reminders: { reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5 },
};

describe('updateNotificationSettings', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('rejects non-admin with SettingsUpdateError', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = nonAdminCtx(s);

    await expect(
      updateNotificationSettings(getAppPool(), ctx, defaultInput),
    ).rejects.toThrow(SettingsUpdateError);

    await expect(
      updateNotificationSettings(getAppPool(), ctx, defaultInput),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('encrypts password and webhook URLs on UPSERT — verify decrypted values', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);

    await updateNotificationSettings(getAppPool(), ctx, {
      ...defaultInput,
      smtp: { ...defaultInput.smtp, password: 'my-smtp-pass' },
      teams: { webhookUrl: 'https://teams.example.com/hook' },
      slack: { webhookUrl: 'https://hooks.slack.com/T1' },
    });

    const { rows } = await getPool().query(
      `SELECT smtp_password_encrypted, teams_webhook_url_encrypted, slack_webhook_url_encrypted
         FROM tenant_settings WHERE tenant_id = $1`,
      [s.tenantId],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(decryptSecret(row.smtp_password_encrypted)).toBe('my-smtp-pass');
    expect(decryptSecret(row.teams_webhook_url_encrypted)).toBe('https://teams.example.com/hook');
    expect(decryptSecret(row.slack_webhook_url_encrypted)).toBe('https://hooks.slack.com/T1');
  });

  it('preserves existing password when password field is undefined', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);

    // First call: set a password
    await updateNotificationSettings(getAppPool(), ctx, {
      ...defaultInput,
      smtp: { host: 'smtp.example.com', port: 587, user: 'u', password: 'original-pass', from: null, secure: false },
    });

    const { rows: before } = await getPool().query(
      `SELECT smtp_password_encrypted FROM tenant_settings WHERE tenant_id = $1`,
      [s.tenantId],
    );
    const originalEncrypted = before[0].smtp_password_encrypted;

    // Second call: update host but omit password
    await updateNotificationSettings(getAppPool(), ctx, {
      ...defaultInput,
      smtp: { host: 'smtp.new.com', port: 465, user: 'u2', from: null, secure: true },
    });

    const { rows: after } = await getPool().query(
      `SELECT smtp_host, smtp_password_encrypted FROM tenant_settings WHERE tenant_id = $1`,
      [s.tenantId],
    );
    expect(after[0].smtp_host).toBe('smtp.new.com');
    // Password preserved — same encrypted value
    expect(after[0].smtp_password_encrypted).toBe(originalEncrypted);
    expect(decryptSecret(after[0].smtp_password_encrypted)).toBe('original-pass');
  });

  it('UPSERTs tenant_notification_config for all 4 channels', async () => {
    const s = await createDomainScenario(getPool());
    const ctx = adminCtx(s);

    await updateNotificationSettings(getAppPool(), ctx, {
      ...defaultInput,
      channels: { in_app: true, email: true, teams: false, slack: true },
    });

    const { rows } = await getPool().query(
      `SELECT channel, enabled FROM tenant_notification_config
        WHERE tenant_id = $1 ORDER BY channel`,
      [s.tenantId],
    );
    const map = Object.fromEntries(rows.map((r: { channel: string; enabled: boolean }) => [r.channel, r.enabled]));
    expect(map['in_app']).toBe(true);
    expect(map['email']).toBe(true);
    expect(map['teams']).toBe(false);
    expect(map['slack']).toBe(true);

    // UPSERT: flip channels
    await updateNotificationSettings(getAppPool(), ctx, {
      ...defaultInput,
      channels: { in_app: false, email: false, teams: true, slack: false },
    });

    const { rows: rows2 } = await getPool().query(
      `SELECT channel, enabled FROM tenant_notification_config
        WHERE tenant_id = $1 ORDER BY channel`,
      [s.tenantId],
    );
    const map2 = Object.fromEntries(rows2.map((r: { channel: string; enabled: boolean }) => [r.channel, r.enabled]));
    expect(map2['in_app']).toBe(false);
    expect(map2['email']).toBe(false);
    expect(map2['teams']).toBe(true);
    expect(map2['slack']).toBe(false);
  });
});
