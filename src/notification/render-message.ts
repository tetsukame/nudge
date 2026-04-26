import type { NotificationContext } from './channel';

export function renderMessage(ctx: NotificationContext): { title: string; body: string } {
  const title = (typeof ctx.payload.title === 'string' && ctx.payload.title) || '依頼';
  switch (ctx.kind) {
    case 'created':
      return { title: '📋 依頼が届きました', body: `「${title}」\n\n${ctx.recipientName} さん宛の依頼があります。` };
    case 'reminder_before':
      return { title: '⏰ 期限が近づいています', body: `「${title}」\n\n${ctx.recipientName} さん、対応をお願いします。` };
    case 'due_today':
      return { title: '🔴 本日が期限です', body: `「${title}」\n\n${ctx.recipientName} さん、至急対応をお願いします。` };
    case 're_notify':
      return { title: '⚠️ 期限超過', body: `「${title}」\n\n${ctx.recipientName} さん、ご確認ください。` };
    case 'completed':
      return { title: '✅ 依頼が完了しました', body: `「${title}」が完了されました。` };
  }
}
