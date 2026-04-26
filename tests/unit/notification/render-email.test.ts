import { describe, it, expect } from 'vitest';
import { renderEmail } from '../../../src/notification/render-email.js';
import type { NotificationContext } from '../../../src/notification/channel.js';

function makeCtx(
  kind: NotificationContext['kind'],
  overrides?: Partial<NotificationContext>,
): NotificationContext {
  return {
    notificationId: 'n1',
    tenantId: 't1',
    requestId: 'r1',
    assignmentId: null,
    recipientUserId: 'u1',
    recipientEmail: 'user@example.com',
    recipientName: 'テストユーザー',
    kind,
    payload: { title: 'サンプル依頼' },
    ...overrides,
  };
}

const cases: Array<{ kind: NotificationContext['kind']; marker: string }> = [
  { kind: 'created', marker: '依頼が届きました' },
  { kind: 'reminder_before', marker: '期限が近づいています' },
  { kind: 'due_today', marker: '本日が期限です' },
  { kind: 're_notify', marker: '期限超過のご連絡' },
  { kind: 'completed', marker: '依頼が完了されました' },
];

describe('renderEmail', () => {
  describe.each(cases)('kind=$kind', ({ kind, marker }) => {
    it('subject contains marker and title', () => {
      const { subject } = renderEmail(makeCtx(kind));
      expect(subject).toContain(marker);
      expect(subject).toContain('サンプル依頼');
    });

    it('text body starts with recipient name', () => {
      const { text } = renderEmail(makeCtx(kind));
      expect(text).toMatch(/^テストユーザー 様/);
    });
  });

  it('falls back to 依頼 when payload.title is missing', () => {
    const { subject } = renderEmail(makeCtx('created', { payload: {} }));
    expect(subject).toContain('依頼');
    expect(subject).not.toContain('undefined');
  });

  it('falls back to 依頼 when payload.title is non-string', () => {
    const { subject } = renderEmail(makeCtx('created', { payload: { title: 42 } }));
    expect(subject).toContain('依頼');
  });
});
