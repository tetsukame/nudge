import type { TenantSettings } from './types';
import type { NotificationKind } from '../domain/_constants';

export type NotificationContext = {
  notificationId: string;
  tenantId: string;
  requestId: string | null;
  assignmentId: string | null;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

export interface Channel {
  readonly type: 'in_app' | 'email' | 'teams' | 'slack';
  send(ctx: NotificationContext, settings: TenantSettings): Promise<void>;
}

export class ChannelError extends Error {
  constructor(message: string, readonly code: 'config_missing' | 'transport_error') {
    super(message);
    this.name = 'ChannelError';
  }
}
