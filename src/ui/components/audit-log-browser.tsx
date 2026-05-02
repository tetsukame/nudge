'use client';

import { Fragment, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type AuditItem = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: string;
};

type Props = {
  tenantCode: string;
  initialItems: AuditItem[];
  initialTotal: number;
  actions: string[];
};

const PAGE_SIZE = 50;

function fmt(d: string): string {
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
}

export function AuditLogBrowser({ tenantCode, initialItems, initialTotal, actions }: Props) {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AuditItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => { setPage(1); }, [action, from, to]);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    fetch(`/t/${tenantCode}/api/admin/audit?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { items: AuditItem[]; total: number }) => {
        if (aborted) return;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(async (err) => {
        if (aborted) return;
        const msg = err instanceof Response
          ? (await err.json().catch(() => ({}))).error ?? 'エラー'
          : 'エラー';
        setError(msg);
      })
      .finally(() => { if (!aborted) setLoading(false); });
    return () => { aborted = true; };
  }, [action, from, to, page, tenantCode]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700" htmlFor="filter-action">アクション</label>
          <select
            id="filter-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">（すべて）</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700" htmlFor="filter-from">期間（開始）</label>
          <input
            id="filter-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700" htmlFor="filter-to">期間（終了）</label>
          <input
            id="filter-to"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <p>
          該当 <span className="font-semibold text-gray-900">{total}</span> 件
          {totalPages > 1 && ` (ページ ${page} / ${totalPages})`}
        </p>
        {loading && <span className="text-xs text-gray-500">読み込み中...</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 && !loading ? (
        <p className="text-center text-sm text-gray-500 py-8">該当ログがありません。</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium w-44">日時</th>
                <th className="px-3 py-2 font-medium">実行者</th>
                <th className="px-3 py-2 font-medium">アクション</th>
                <th className="px-3 py-2 font-medium">対象</th>
                <th className="px-3 py-2 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => {
                const isOpen = expanded.has(it.id);
                return (
                  <Fragment key={it.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs whitespace-nowrap">
                        {fmt(it.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        {it.actorName ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-700">
                        {it.action}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        <span className="text-gray-500">{it.targetType}</span>
                        {it.targetId && (
                          <span className="ml-1 text-gray-400 font-mono">{it.targetId.slice(0, 8)}…</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(it.id)}
                          className={cn(
                            'text-xs px-2 py-1 rounded border transition-colors',
                            isOpen
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'text-gray-600 border-gray-200 hover:bg-gray-100',
                          )}
                        >
                          {isOpen ? '閉じる' : '詳細'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-3 py-3">
                          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-all">
{JSON.stringify({
  id: it.id,
  actorUserId: it.actorUserId,
  targetId: it.targetId,
  payload: it.payloadJson,
}, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1 || loading}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            ← 前へ
          </button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  );
}
