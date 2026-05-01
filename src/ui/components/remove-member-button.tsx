'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  tenantCode: string;
  groupId: string;
  userId: string;
};

export function RemoveMemberButton({ tenantCode, groupId, userId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (!confirm('このメンバーをグループから外しますか？')) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/groups/${groupId}/members/${userId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert((data as { error?: string }).error ?? `エラー (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={busy}
      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded border border-red-200 transition-colors disabled:opacity-50"
    >
      外す
    </button>
  );
}
