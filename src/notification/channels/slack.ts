import type { Channel, NotificationContext } from '../channel';
import { ChannelError } from '../channel';
import type { TenantSettings } from '../types';
import { decryptSecret } from '../crypto';
import { renderMessage } from '../render-message';

export class SlackChannel implements Channel {
  readonly type = 'slack' as const;

  async send(ctx: NotificationContext, settings: TenantSettings): Promise<void> {
    if (!settings.slackWebhookUrlEncrypted) {
      throw new ChannelError('Slack webhook URL not configured', 'config_missing');
    }

    const webhookUrl = decryptSecret(settings.slackWebhookUrlEncrypted);
    const { title, body } = renderMessage(ctx);

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${title}*\n${body}`,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ChannelError(
        `Slack webhook fetch failed: ${(err as Error).message}`,
        'transport_error',
      );
    }

    if (!response.ok) {
      throw new ChannelError(
        `Slack webhook returned HTTP ${response.status}`,
        'transport_error',
      );
    }
  }
}
