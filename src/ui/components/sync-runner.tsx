'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type Tenant = {
  id: string;
  code: string;
  name: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

type Mode = 'full' | 'delta' | 'full-with-orgs';

const MODE_LABELS: Record<Mode, string> = {
  full: 'Full (全件)',
  delta: 'Delta (差分のみ)',
  'full-with-orgs': 'Full + 組織同期',
};

export function SyncRunner({ tenants }: { tenants: Tenant[] }) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string>(tenants[0]?.id ?? '');
  const [mode, setMode] = useState<Mode>('delta');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleRun() {
    if (!tenantId) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/root/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: (data as { error?: string }).error ?? `エラー (${res.status})` });
      } else {
        const r = data as { syncType: string; created: number; updated: number; deactivated: number; reactivated: number; durationMs: number; orgs?: unknown };
        const orgsPart = r.orgs ? ` / 組織同期: ${JSON.stringify(r.orgs)}` : '';
        setResult({
          ok: true,
          message: `成功: created=${r.created} updated=${r.updated} deactivated=${r.deactivated} reactivated=${r.reactivated} (${r.durationMs}ms)${orgsPart}`,
        });
        router.refresh();
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : '予期しないエラー' });
    } finally {
      setBusy(false);
    }
  }

  if (tenants.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-800">
        同期実行可能なテナントがありません。テナント編集画面で「同期を有効にする」+ Client ID / Secret を設定してください。
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
      <h2 className="text-sm font-medium text-gray-700">同期を実行</h2>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700">テナント</label>
          <select
            value={tenantId} onChange={(e) => setTenantId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700">モード</label>
          <select
            value={mode} onChange={(e) => setMode(e.target.value as Mode)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABELS[m]}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleRun} disabled={busy || !tenantId}>
          {busy ? '実行中...' : '同期実行'}
        </Button>
      </div>
      {result && (
        <p className={`text-xs px-3 py-2 rounded ${result.ok ? 'text-green-700 bg-green-50 border border-green-200' : 'text-red-700 bg-red-50 border border-red-200'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
