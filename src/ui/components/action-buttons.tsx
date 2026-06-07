'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/ui/components/confirm-dialog';
import { useAsyncAction } from '@/ui/hooks/use-async-action';
import { apiSend } from '@/lib/api-fetch';

type Props = {
  tenantCode: string;
  assignmentId: string;
  requestId: string;
  status: string;
};

type DialogType = 'respond' | 'not_needed' | null;

export function ActionButtons({ tenantCode, assignmentId, requestId, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogType>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');

  const respond = useAsyncAction(async () => {
    await apiSend(`/t/${tenantCode}/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'respond', note: note || undefined }),
    });
    setOpen(null);
    setNote('');
    router.refresh();
  });

  const notNeeded = useAsyncAction(async () => {
    await apiSend(`/t/${tenantCode}/api/assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'not_needed', reason }),
    });
    setOpen(null);
    setReason('');
    router.refresh();
  });

  if (status !== 'unopened' && status !== 'opened') {
    return null;
  }

  return (
    <>
      <div className="flex gap-3 flex-wrap">
        <Button
          variant="default"
          onClick={() => { setOpen('respond'); setNote(''); respond.reset(); }}
        >
          ✅ 対応済み
        </Button>
        <Button
          variant="destructive"
          onClick={() => { setOpen('not_needed'); setReason(''); notNeeded.reset(); }}
        >
          🚫 対応不要
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push(`/t/${tenantCode}/requests/${requestId}/forward`)}
        >
          ↗️ 転送
        </Button>
      </div>

      <ConfirmDialog
        open={open === 'respond'}
        onOpenChange={(v) => !v && setOpen(null)}
        title="対応済みにする"
        description="この依頼を対応済みとして記録します。必要であればメモを入力してください。"
        confirmLabel="対応済みにする"
        busyLabel="送信中..."
        busy={respond.busy}
        error={respond.error}
        onConfirm={() => void respond.run()}
      >
        <div className="space-y-2">
          <Label htmlFor="respond-note">メモ（任意）</Label>
          <Textarea
            id="respond-note"
            placeholder="対応内容や備考をここに入力..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={open === 'not_needed'}
        onOpenChange={(v) => !v && setOpen(null)}
        title="対応不要にする"
        description="対応不要とする理由を入力してください（必須）。"
        confirmLabel="対応不要にする"
        busyLabel="送信中..."
        busy={notNeeded.busy}
        error={notNeeded.error}
        danger
        disabled={!reason.trim()}
        onConfirm={() => void notNeeded.run()}
      >
        <div className="space-y-2">
          <Label htmlFor="not-needed-reason">理由（必須）</Label>
          <Textarea
            id="not-needed-reason"
            placeholder="対応不要とする理由を入力してください..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
