'use client';

import { Fragment, useState } from 'react';
import { cn } from '@/lib/utils';

type Item = {
  id: string;
  tenantCode: string;
  tenantName: string;
  syncType: string;
  sourceType: string;
  status: string;
  createdCount: number;
  updatedCount: number;
  deactivatedCount: number;
  reactivatedCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

function fmt(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}

function statusBadge(s: string) {
  if (s === 'success') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'running') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s === 'failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-gray-100 text-gray-600 border-gray-300';
}

export function SyncLogTable({ items }: { items: Item[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (items.length === 0) {
    return <p className="text-center text-sm text-gray-500 py-8">同期実行履歴はありません。</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-600">
        <tr>
          <th className="px-3 py-2 font-medium">テナント</th>
          <th className="px-3 py-2 font-medium">モード</th>
          <th className="px-3 py-2 font-medium">状態</th>
          <th className="px-3 py-2 font-medium">作成 / 更新 / 無効化 / 再有効化</th>
          <th className="px-3 py-2 font-medium w-44">開始</th>
          <th className="px-3 py-2 font-medium w-44">終了</th>
          <th className="px-3 py-2 font-medium w-12"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {items.map((it) => {
          const isOpen = open.has(it.id);
          return (
            <Fragment key={it.id}>
              <tr className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <p className="text-gray-900">{it.tenantName}</p>
                  <p className="text-xs text-gray-500 font-mono">{it.tenantCode}</p>
                </td>
                <td className="px-3 py-2 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{it.syncType}</span>
                  <span className="ml-1 text-gray-500">{it.sourceType}</span>
                </td>
                <td className="px-3 py-2">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded border', statusBadge(it.status))}>
                    {it.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-700">
                  {it.createdCount} / {it.updatedCount} / {it.deactivatedCount} / {it.reactivatedCount}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600 font-mono whitespace-nowrap">{fmt(it.startedAt)}</td>
                <td className="px-3 py-2 text-xs text-gray-600 font-mono whitespace-nowrap">{fmt(it.finishedAt)}</td>
                <td className="px-3 py-2 text-right">
                  {it.errorMessage && (
                    <button
                      type="button" onClick={() => toggle(it.id)}
                      className={cn(
                        'text-xs px-2 py-1 rounded border transition-colors',
                        isOpen ? 'bg-red-100 text-red-700 border-red-300' : 'text-red-600 border-red-200 hover:bg-red-50',
                      )}
                    >
                      {isOpen ? '閉' : 'エラー'}
                    </button>
                  )}
                </td>
              </tr>
              {isOpen && it.errorMessage && (
                <tr className="bg-red-50">
                  <td colSpan={7} className="px-4 py-2 text-xs text-red-700 whitespace-pre-wrap break-all font-mono">
                    {it.errorMessage}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
