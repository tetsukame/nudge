'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSending(true);
    setError('');
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', reason: '予約取り消し' }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `エラー (${res.status})`,
        );
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setSending(false);
    }
  }

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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>予約送信を取り消す</DialogTitle>
            <DialogDescription>
              「{title}」 の予約送信を取り消します。<br />
              送信予定: {new Date(scheduledAt).toLocaleString('ja-JP')}<br />
              <span className="text-xs text-gray-500">
                まだ誰にも通知されていないため、受信者への通知は発生しません。
              </span>
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={sending}
            >
              戻る
            </Button>
            <Button
              variant="destructive"
              onClick={() => void submit()}
              disabled={sending}
            >
              {sending ? '取り消し中...' : '予約を取り消す'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
