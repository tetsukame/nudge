import { describe, it, expect, beforeEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { EmailChannel } from '../../../../src/notification/channels/email.js';
import { ChannelError } from '../../../../src/notification/channel.js';
import { encryptSmtpPassword } from '../../../../src/notification/crypto.js';
import type { NotificationContext } from '../../../../src/notification/channel.js';
import type { TenantSettings } from '../../../../src/notification/types.js';

const ctx: NotificationContext = {
  notificationId: 'n1',
  tenantId: 't1',
  requestId: 'r1',
  assignmentId: null,
  recipientUserId: 'u1',
  recipientEmail: 'user@example.com',
  recipientName: 'Test User',
  kind: 'created',
  payload: { title: 'Test Request' },
};

function makeSettings(overrides?: Partial<TenantSettings>): TenantSettings {
  return {
    tenantId: 't1',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: null,
    smtpPasswordEncrypted: null,
    smtpFrom: 'noreply@example.com',
    smtpSecure: false,
    reminderBeforeDays: 3,
    reNotifyIntervalDays: 7,
    reNotifyMaxCount: 3,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('EmailChannel', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('throws ChannelError when smtpHost is missing', async () => {
    const channel = new EmailChannel();
    const settings = makeSettings({ smtpHost: null });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'config_missing' });
  });

  it('throws ChannelError when smtpFrom is missing', async () => {
    const channel = new EmailChannel();
    const settings = makeSettings({ smtpFrom: null });
    await expect(channel.send(ctx, settings)).rejects.toThrow(ChannelError);
    await expect(channel.send(ctx, settings)).rejects.toMatchObject({ code: 'config_missing' });
  });

  it('sends mail via nodemailer with rendered subject/body', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);

    const channel = new EmailChannel();
    const settings = makeSettings();
    await channel.send(ctx, settings);

    expect(sendMail).toHaveBeenCalledOnce();
    const callArgs = sendMail.mock.calls[0][0];
    expect(callArgs.to).toBe(ctx.recipientEmail);
    expect(callArgs.from).toBe(settings.smtpFrom);
    expect(callArgs.subject).toContain('依頼が届きました');
    expect(callArgs.subject).toContain('Test Request');
    expect(callArgs.text).toMatch(/^Test User 様/);
  });

  it('decrypts SMTP password when configured', async () => {
    const plainPassword = 'my-smtp-secret';
    const encrypted = encryptSmtpPassword(plainPassword);

    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm2' });
    const createTransportSpy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);

    const channel = new EmailChannel();
    const settings = makeSettings({
      smtpUser: 'smtp-user@example.com',
      smtpPasswordEncrypted: encrypted,
    });
    await channel.send(ctx, settings);

    expect(createTransportSpy).toHaveBeenCalledOnce();
    const transportConfig = createTransportSpy.mock.calls[0][0] as { auth: { user: string; pass: string } };
    expect(transportConfig.auth).toBeDefined();
    expect(transportConfig.auth.pass).toBe(plainPassword);
    expect(transportConfig.auth.user).toBe('smtp-user@example.com');
  });
});
