'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { ConfirmDialog } from '@/ui/components/confirm-dialog';
import { useAsyncAction } from '@/ui/hooks/use-async-action';
import { apiSend } from '@/lib/api-fetch';

type Props = {
  tenantCode: string;
  requestId: string;
  title: string;
  scheduledAt: string;
};

export function ScheduledCancelButton({
  tenantCode, requestId, title, scheduledAt,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const action = useAsyncAction(async () => {
    await apiSend(`/t/${tenantCode}/api/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'cancel', reason: '予約取り消し' }),
    });
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10 transition-colors"
      >
        <XCircle className="h-3.5 w-3.5" />
        予約を取り消す
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="予約送信を取り消す"
        description={
          <>
            「{title}」 の予約送信を取り消します。<br />
            送信予定: {new Date(scheduledAt).toLocaleString('ja-JP')}<br />
            <span className="text-xs text-gray-500">
              まだ誰にも通知されていないため、受信者への通知は発生しません。
            </span>
          </>
        }
        cancelLabel="戻る"
        confirmLabel="予約を取り消す"
        busyLabel="取り消し中..."
        busy={action.busy}
        error={action.error}
        danger
        onConfirm={() => void action.run()}
      />
    </>
  );
}
