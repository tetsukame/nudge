import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SlackChannel } from '../../../../src/notification/channels/slack.js';
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

describe('SlackChannel', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws config_missing when slackWebhookUrlEncrypted is null', async () => {
    const channel = new SlackChannel();
    const settings = makeSettings({ slackWebhookUrlEncrypted: null });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'config_missing' });
  });

  it('POSTs text payload to decrypted webhook URL on 200', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/test';
    const encrypted = encryptSecret(webhookUrl);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const channel = new SlackChannel();
    const settings = makeSettings({ slackWebhookUrlEncrypted: encrypted });
    await channel.send(ctx, settings);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(webhookUrl);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toMatchObject({ 'Content-Type': 'application/json' });

    const body = JSON.parse(calledInit.body as string);
    expect(typeof body.text).toBe('string');
    expect(body.text).toContain('届きました');
  });

  it('throws transport_error on non-2xx response', async () => {
    const webhookUrl = 'https://hooks.slack.com/services/test';
    const encrypted = encryptSecret(webhookUrl);

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const channel = new SlackChannel();
    const settings = makeSettings({ slackWebhookUrlEncrypted: encrypted });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'transport_error' });
  });

  it('throws ChannelError on fetch timeout (AbortError)', async () => {
    const url = 'https://hooks.slack.com/services/xyz';
    const enc = encryptSecret(url);
    const fetchMock = vi.fn().mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ch = new SlackChannel();
    await expect(
      ch.send(ctx, makeSettings({ slackWebhookUrlEncrypted: enc })),
    ).rejects.toBeInstanceOf(ChannelError);
  });
});
