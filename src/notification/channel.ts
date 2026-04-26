import type { TenantSettings } from './types';

export type NotificationContext = {
  notificationId: string;
  tenantId: string;
  requestId: string | null;
  assignmentId: string | null;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string;
  kind: 'created' | 'reminder_before' | 'due_today' | 're_notify' | 'completed';
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
