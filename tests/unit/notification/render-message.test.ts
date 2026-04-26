import { describe, it, expect } from 'vitest';
import { renderMessage } from '../../../src/notification/render-message.js';
import type { NotificationContext } from '../../../src/notification/channel.js';

function makeCtx(kind: NotificationContext['kind'], payloadTitle?: string): NotificationContext {
  return {
    notificationId: 'n1',
    tenantId: 't1',
    requestId: 'r1',
    assignmentId: null,
    recipientUserId: 'u1',
    recipientEmail: 'user@example.com',
    recipientName: '田中',
    kind,
    payload: payloadTitle !== undefined ? { title: payloadTitle } : {},
  };
}

describe('renderMessage', () => {
  it('created: title contains 届きました, body contains recipientName and payload title', () => {
    const { title, body } = renderMessage(makeCtx('created', 'テスト依頼'));
    expect(title).toContain('届きました');
    expect(body).toContain('田中');
    expect(body).toContain('テスト依頼');
  });

  it('reminder_before: title contains 近づいています, body contains recipientName and payload title', () => {
    const { title, body } = renderMessage(makeCtx('reminder_before', 'テスト依頼'));
    expect(title).toContain('近づいています');
    expect(body).toContain('田中');
    expect(body).toContain('テスト依頼');
  });

  it('due_today: title contains 本日が期限, body contains recipientName and payload title', () => {
    const { title, body } = renderMessage(makeCtx('due_today', 'テスト依頼'));
    expect(title).toContain('本日が期限');
    expect(body).toContain('田中');
    expect(body).toContain('テスト依頼');
  });

  it('re_notify: title contains 期限超過, body contains recipientName and payload title', () => {
    const { title, body } = renderMessage(makeCtx('re_notify', 'テスト依頼'));
    expect(title).toContain('期限超過');
    expect(body).toContain('田中');
    expect(body).toContain('テスト依頼');
  });

  it('completed: title contains 完了, body contains payload title', () => {
    const { title, body } = renderMessage(makeCtx('completed', 'テスト依頼'));
    expect(title).toContain('完了');
    expect(body).toContain('テスト依頼');
  });

  it('missing payload.title falls back to 依頼 in body', () => {
    const { body } = renderMessage(makeCtx('created'));
    expect(body).toContain('依頼');
  });
});
