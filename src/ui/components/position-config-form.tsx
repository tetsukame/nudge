'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = {
  tenantCode: string;
  initialPositions: string[];
};

export function PositionConfigForm({ tenantCode, initialPositions }: Props) {
  const router = useRouter();
  const [positions, setPositions] = useState<string[]>(initialPositions);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  function addDraft() {
    const v = draft.trim();
    if (!v || positions.includes(v)) {
      setDraft('');
      return;
    }
    setPositions((p) => [...p, v]);
    setDraft('');
  }

  function remove(pos: string) {
    setPositions((p) => p.filter((x) => x !== pos));
  }

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/admin/settings/positions`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ managerPositions: positions }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {positions.length === 0 && (
          <span className="text-sm text-gray-400">職位が未登録です</span>
        )}
        {positions.map((p) => (
          <span
            key={p}
            className="inline-flex items-center gap-1 text-sm px-2.5 py-1 rounded-md border border-primary/30 bg-primary/10 text-primary"
          >
            {p}
            <button
              type="button"
              onClick={() => remove(p)}
              disabled={busy}
              className="hover:text-destructive"
              aria-label={`${p} を削除`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-gray-600" htmlFor="pos-draft">
            職位を追加
          </label>
          <Input
            id="pos-draft"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
            placeholder="例: 課長"
            className="max-w-xs"
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addDraft} disabled={busy}>
          追加
        </Button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-emerald-700">保存しました。次回の同期から反映されます。</p>
      )}

      <Button onClick={() => void save()} disabled={busy || positions.length === 0}>
        {busy ? '保存中...' : '保存'}
      </Button>
    </div>
  );
}
