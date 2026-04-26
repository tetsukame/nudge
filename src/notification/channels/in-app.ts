import type { Channel, NotificationContext } from '../channel';
import type { TenantSettings } from '../types';

export class InAppChannel implements Channel {
  readonly type = 'in_app' as const;
  async send(_ctx: NotificationContext, _settings: TenantSettings): Promise<void> {
    // No-op: the notification row itself is the in-app notification.
  }
}
