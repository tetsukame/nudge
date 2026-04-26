import { describe, it, expect } from 'vitest';
import { InAppChannel } from '../../../../src/notification/channels/in-app.js';
import type { NotificationContext } from '../../../../src/notification/channel.js';
import type { TenantSettings } from '../../../../src/notification/types.js';

const ctx: NotificationContext = {
  notificationId: 'n1',
  tenantId: 't1',
  requestId: 'r1',
  assignmentId: 'a1',
  recipientUserId: 'u1',
  recipientEmail: 'user@example.com',
  recipientName: 'Test User',
  kind: 'created',
  payload: { title: 'Test Request' },
};

const settings: TenantSettings = {
  tenantId: 't1',
  smtpHost: null,
  smtpPort: null,
  smtpUser: null,
  smtpPasswordEncrypted: null,
  smtpFrom: null,
  smtpSecure: false,
  reminderBeforeDays: 3,
  reNotifyIntervalDays: 7,
  reNotifyMaxCount: 3,
  updatedAt: new Date(),
};

describe('InAppChannel', () => {
  it('type is in_app', () => {
    const channel = new InAppChannel();
    expect(channel.type).toBe('in_app');
  });

  it('send resolves without throwing (no-op)', async () => {
    const channel = new InAppChannel();
    await expect(channel.send(ctx, settings)).resolves.toBeUndefined();
  });
});
