'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (status !== 'unopened' && status !== 'opened') {
    return null;
  }

  async function dispatch(action: string, payload: Record<string, unknown>) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setOpen(null);
      setNote('');
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex gap-3 flex-wrap">
        <Button
          variant="default"
          onClick={() => { setOpen('respond'); setNote(''); setError(''); }}
        >
          ✅ 対応済み
        </Button>
        <Button
          variant="destructive"
          onClick={() => { setOpen('not_needed'); setReason(''); setError(''); }}
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

      {/* Respond dialog */}
      <Dialog open={open === 'respond'} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>対応済みにする</DialogTitle>
            <DialogDescription>
              この依頼を対応済みとして記録します。必要であればメモを入力してください。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="respond-note">メモ（任意）</Label>
            <Textarea
              id="respond-note"
              placeholder="対応内容や備考をここに入力..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={loading}>
              キャンセル
            </Button>
            <Button
              onClick={() => dispatch('respond', { note: note || undefined })}
              disabled={loading}
            >
              {loading ? '送信中...' : '対応済みにする'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Not Needed dialog */}
      <Dialog open={open === 'not_needed'} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>対応不要にする</DialogTitle>
            <DialogDescription>
              対応不要とする理由を入力してください（必須）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="not-needed-reason">理由（必須）</Label>
            <Textarea
              id="not-needed-reason"
              placeholder="対応不要とする理由を入力してください..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={loading}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => dispatch('not_needed', { reason })}
              disabled={loading || !reason.trim()}
            >
              {loading ? '送信中...' : '対応不要にする'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
