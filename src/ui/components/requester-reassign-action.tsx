'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UserSearch, type UserResult } from '@/ui/components/user-search';

type Props = {
  tenantCode: string;
  requestId: string;
  currentRequesterName: string | null;
};

/**
 * 退職者が作成した依頼の「依頼者を差し替え」アクション。
 * tenant_admin が新しいアクティブユーザーを選んで request.created_by を付け替える。
 */
export function RequesterReassignAction({
  tenantCode, requestId, currentRequesterName,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<UserResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/admin/requests/${requestId}/requester`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: selected.id }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setOpen(false);
      setSelected(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(''); }}
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
      >
        <UserCog className="h-3.5 w-3.5" />
        依頼者を差し替え
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>依頼者を差し替え</DialogTitle>
            <DialogDescription>
              現在の依頼者
              {currentRequesterName ? `「${currentRequesterName}」` : ''}
              は退職済みです。引き継ぐアクティブな職員を選んでください。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <UserSearch
              tenantCode={tenantCode}
              selectedId={selected?.id ?? null}
              onSelect={(u) => setSelected(u)}
              placeholder="名前・メールで検索"
            />
            {selected && (
              <p className="text-xs text-emerald-700">
                新しい依頼者: {selected.displayName}（{selected.email}）
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              キャンセル
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !selected}>
              {busy ? '差し替え中...' : '差し替える'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
