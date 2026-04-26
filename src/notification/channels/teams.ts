import type { Channel, NotificationContext } from '../channel';
import { ChannelError } from '../channel';
import type { TenantSettings } from '../types';
import { decryptSecret } from '../crypto';
import { renderMessage } from '../render-message';

export class TeamsChannel implements Channel {
  readonly type = 'teams' as const;

  async send(ctx: NotificationContext, settings: TenantSettings): Promise<void> {
    if (!settings.teamsWebhookUrlEncrypted) {
      throw new ChannelError('Teams webhook URL not configured', 'config_missing');
    }

    const webhookUrl = decryptSecret(settings.teamsWebhookUrlEncrypted);
    const { title, body } = renderMessage(ctx);

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'https://schema.org/extensions',
          title,
          text: body.replace(/\n/g, '<br>'),
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ChannelError(
        `Teams webhook fetch failed: ${(err as Error).message}`,
        'transport_error',
      );
    }

    if (!response.ok) {
      throw new ChannelError(
        `Teams webhook returned HTTP ${response.status}`,
        'transport_error',
      );
    }
  }
}
