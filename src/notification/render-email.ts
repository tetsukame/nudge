import type { NotificationContext } from './channel';

const KIND_MARKERS: Record<NotificationContext['kind'], string> = {
  created: '依頼が届きました',
  reminder_before: '期限が近づいています',
  due_today: '本日が期限です',
  re_notify: '期限超過のご連絡',
  completed: '依頼が完了されました',
};

export function renderEmail(ctx: NotificationContext): { subject: string; text: string } {
  const title =
    typeof ctx.payload.title === 'string' && ctx.payload.title.length > 0
      ? ctx.payload.title
      : '依頼';

  const greeting = `${ctx.recipientName} 様\n\n`;

  switch (ctx.kind) {
    case 'completed': {
      const completedBy = (typeof ctx.payload.completedBy === 'string' && ctx.payload.completedBy) || '担当者';
      return {
        subject: `【Nudge】依頼が完了されました: ${title}`,
        text: `${greeting}依頼が完了されました。\n\n依頼: ${title}\n対応者: ${completedBy}`,
      };
    }
    default: {
      const marker = KIND_MARKERS[ctx.kind];
      const subject = `【Nudge】${marker}: ${title}`;
      const text = `${greeting}${marker}: ${title}`;
      return { subject, text };
    }
  }
}
