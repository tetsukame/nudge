import nodemailer from 'nodemailer';
import type { Channel, NotificationContext } from '../channel';
import { ChannelError } from '../channel';
import type { TenantSettings } from '../types';
import { decryptSmtpPassword } from '../crypto';
import { renderEmail } from '../render-email';

export class EmailChannel implements Channel {
  readonly type = 'email' as const;

  async send(ctx: NotificationContext, settings: TenantSettings): Promise<void> {
    if (!settings.smtpHost) {
      throw new ChannelError('SMTP host not configured', 'config_missing');
    }
    if (!settings.smtpFrom) {
      throw new ChannelError('SMTP from address not configured', 'config_missing');
    }

    const auth = settings.smtpUser && settings.smtpPasswordEncrypted
      ? {
          user: settings.smtpUser,
          pass: decryptSmtpPassword(settings.smtpPasswordEncrypted),
        }
      : undefined;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort ?? 587,
      secure: settings.smtpSecure,
      auth,
    });

    const { subject, text } = renderEmail(ctx);
    try {
      await transporter.sendMail({
        from: settings.smtpFrom,
        to: ctx.recipientEmail,
        subject,
        text,
      });
    } catch (err) {
      throw new ChannelError(
        `SMTP send failed: ${(err as Error).message}`,
        'transport_error',
      );
    }
  }
}
