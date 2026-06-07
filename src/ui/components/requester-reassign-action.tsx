'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCog } from 'lucide-react';
import { ConfirmDialog } from '@/ui/components/confirm-dialog';
import { useAsyncAction } from '@/ui/hooks/use-async-action';
import { apiSend } from '@/lib/api-fetch';
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

  const action = useAsyncAction(async () => {
    if (!selected) return;
    await apiSend(
      `/t/${tenantCode}/api/admin/requests/${requestId}/requester`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: selected.id }),
      },
    );
    setOpen(false);
    setSelected(null);
    router.refresh();
  });

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); action.reset(); }}
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-colors"
      >
        <UserCog className="h-3.5 w-3.5" />
        依頼者を差し替え
      </button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="依頼者を差し替え"
        description={
          <>
            現在の依頼者
            {currentRequesterName ? `「${currentRequesterName}」` : ''}
            は退職済みです。引き継ぐアクティブな職員を選んでください。
          </>
        }
        confirmLabel="差し替える"
        busyLabel="差し替え中..."
        busy={action.busy}
        error={action.error}
        disabled={!selected}
        onConfirm={() => void action.run()}
      >
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
      </ConfirmDialog>
    </>
  );
}
