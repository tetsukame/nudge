import type { Channel } from './channel';
import { InAppChannel } from './channels/in-app';
import { EmailChannel } from './channels/email';

const channels: Record<string, Channel> = {
  in_app: new InAppChannel(),
  email: new EmailChannel(),
};

export function getChannel(type: string): Channel | null {
  return channels[type] ?? null;
}
