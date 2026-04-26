import type { Channel } from './channel';
import { InAppChannel } from './channels/in-app';
import { EmailChannel } from './channels/email';
import { TeamsChannel } from './channels/teams';
import { SlackChannel } from './channels/slack';

const channels: Record<string, Channel> = {
  in_app: new InAppChannel(),
  email: new EmailChannel(),
  teams: new TeamsChannel(),
  slack: new SlackChannel(),
};

export function getChannel(type: string): Channel | null {
  return channels[type] ?? null;
}
