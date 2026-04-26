import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeamsChannel } from '../../../../src/notification/channels/teams.js';
import { ChannelError } from '../../../../src/notification/channel.js';
import { encryptSecret } from '../../../../src/notification/crypto.js';
import type { NotificationContext } from '../../../../src/notification/channel.js';
import type { TenantSettings } from '../../../../src/notification/types.js';

const ctx: NotificationContext = {
  notificationId: 'n1',
  tenantId: 't1',
  requestId: 'r1',
  assignmentId: null,
  recipientUserId: 'u1',
  recipientEmail: 'user@example.com',
  recipientName: '田中',
  kind: 'created',
  payload: { title: 'テスト依頼' },
};

function makeSettings(overrides?: Partial<TenantSettings>): TenantSettings {
  return {
    tenantId: 't1',
    smtpHost: null,
    smtpPort: null,
    smtpUser: null,
    smtpPasswordEncrypted: null,
    smtpFrom: null,
    smtpSecure: false,
    teamsWebhookUrlEncrypted: null,
    slackWebhookUrlEncrypted: null,
    reminderBeforeDays: 3,
    reNotifyIntervalDays: 7,
    reNotifyMaxCount: 3,
    ...overrides,
  };
}

describe('TeamsChannel', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws config_missing when teamsWebhookUrlEncrypted is null', async () => {
    const channel = new TeamsChannel();
    const settings = makeSettings({ teamsWebhookUrlEncrypted: null });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'config_missing' });
  });

  it('POSTs MessageCard payload to decrypted webhook URL on 200', async () => {
    const webhookUrl = 'https://outlook.office.com/webhook/test';
    const encrypted = encryptSecret(webhookUrl);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const channel = new TeamsChannel();
    const settings = makeSettings({ teamsWebhookUrlEncrypted: encrypted });
    await channel.send(ctx, settings);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(webhookUrl);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const body = JSON.parse(calledInit.body as string);
    expect(body['@type']).toBe('MessageCard');
    expect(body['@context']).toBe('https://schema.org/extensions');
    expect(body.title).toContain('届きました');
  });

  it('throws transport_error on non-2xx response', async () => {
    const webhookUrl = 'https://outlook.office.com/webhook/test';
    const encrypted = encryptSecret(webhookUrl);

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const channel = new TeamsChannel();
    const settings = makeSettings({ teamsWebhookUrlEncrypted: encrypted });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'transport_error' });
  });

  it('throws transport_error when fetch rejects (network error)', async () => {
    const webhookUrl = 'https://outlook.office.com/webhook/test';
    const encrypted = encryptSecret(webhookUrl);

    const fetchMock = vi.fn().mockRejectedValue(new Error('network failure'));
    vi.stubGlobal('fetch', fetchMock);

    const channel = new TeamsChannel();
    const settings = makeSettings({ teamsWebhookUrlEncrypted: encrypted });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'transport_error' });
  });
});
