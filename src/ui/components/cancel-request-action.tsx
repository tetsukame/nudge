'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  tenantCode: string;
  requestId: string;
  backHref: string;
};

export function CancelRequestAction({ tenantCode, requestId, backHref }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? '取り消しに失敗しました');
      }
      setOpen(false);
      setReason('');
      // 戻り先 (sent / admin/sent / requests) に遷移して取り消し済み状態を反映
      router.push(backHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '取り消しに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-amber-200 p-4 flex items-center justify-between gap-3">
      <div className="text-sm text-gray-700">
        <span className="font-medium">この依頼を取り消す</span>
        <span className="ml-2 text-xs text-gray-500">
          対象者全員に通知が送られ、対応は不要になります
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm px-3 py-1.5 border border-amber-300 text-amber-700 rounded-md hover:bg-amber-50"
      >
        🚫 取り消す
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="font-bold mb-3">依頼の取り消し</h3>
            <p className="text-xs text-gray-600 mb-3">
              対応者全員にメール/Teams/Slack で通知が送られます。
              取り消し後は元に戻せません。
            </p>
            <div className="mb-4">
              <div className="text-sm font-medium mb-1">取り消し理由（必須）</div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full border border-gray-300 rounded-md p-2 text-sm min-h-[80px]"
                placeholder="例: 不要になったため / 別系統で対応するため など"
              />
            </div>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setOpen(false); setError(''); }}
                disabled={busy}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => void submit()}
                disabled={busy || !reason.trim()}
                className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm disabled:opacity-50"
              >
                {busy ? '送信中...' : '取り消す'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
