'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Item = {
  id: string;
  channel: string;
  kind: string;
  recipientUserId: string;
  recipientName: string | null;
  recipientEmail: string | null;
  requestId: string | null;
  requestTitle: string | null;
  attemptCount: number;
  lastError: string | null;
  failedAt: string;
};

type Props = {
  tenantCode: string;
  initialItems: Item[];
  initialTotal: number;
};

const PAGE_SIZE = 50;

function fmt(d: string): string {
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

export function FailedNotificationsBrowser({ tenantCode, initialItems, initialTotal }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function reload(targetPage = page) {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('pageSize', String(PAGE_SIZE));
      const res = await fetch(`/t/${tenantCode}/api/admin/notifications/failed?${params.toString()}`);
      if (!res.ok) throw new Error(`エラー (${res.status})`);
      const data = await res.json() as { items: Item[]; total: number };
      setItems(data.items);
      setTotal(data.total);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (page === 1) return; // initial data already loaded
    void reload(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function retrySelected() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/notifications/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      const retried = (data as { retried?: number }).retried ?? 0;
      setSuccess(`${retried} 件を再送キューに戻しました。worker が次の tick (最大 1 分以内) で送信します。`);
      // refresh list + sidebar badge
      await reload(page);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '再送失敗');
    } finally {
      setSubmitting(false);
    }
  }

  async function retryOne(id: string) {
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/notifications/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setSuccess('再送キューに戻しました。');
      await reload(page);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '再送失敗');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          該当 <span className="font-semibold text-gray-900">{total}</span> 件
          {totalPages > 1 && ` (ページ ${page} / ${totalPages})`}
        </p>
        <Button
          onClick={retrySelected}
          disabled={submitting || selected.size === 0}
          size="sm"
        >
          選択分を再送 ({selected.size})
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      {items.length === 0 && !loading ? (
        <p className="text-center text-sm text-gray-500 py-8">
          ✅ 永続失敗の通知はありません。
        </p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleAll}
                    disabled={submitting}
                  />
                </th>
                <th className="px-3 py-2 font-medium">受信者</th>
                <th className="px-3 py-2 font-medium">チャネル</th>
                <th className="px-3 py-2 font-medium">依頼</th>
                <th className="px-3 py-2 font-medium w-24">試行回数</th>
                <th className="px-3 py-2 font-medium w-44">失敗時刻</th>
                <th className="px-3 py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((it) => {
                const isOpen = expanded.has(it.id);
                return (
                  <Fragment key={it.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggle(it.id)}
                          disabled={submitting}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-gray-900">{it.recipientName ?? '—'}</p>
                        <p className="text-xs text-gray-500">{it.recipientEmail ?? ''}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                          {it.channel}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">{it.kind}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {it.requestTitle ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{it.attemptCount}</td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs whitespace-nowrap">
                        {fmt(it.failedAt)}
                      </td>
                      <td className="px-3 py-2 text-right space-x-1">
                        {it.lastError && (
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
                            {isOpen ? '閉' : 'エラー'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => retryOne(it.id)}
                          disabled={submitting}
                          className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-40"
                        >
                          再送
                        </button>
                      </td>
                    </tr>
                    {isOpen && it.lastError && (
                      <tr className="bg-red-50">
                        <td colSpan={7} className="px-4 py-2 text-xs text-red-700 whitespace-pre-wrap break-all font-mono">
                          {it.lastError}
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
            disabled={page === 1 || loading || submitting}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            ← 前へ
          </button>
          <span className="text-sm text-gray-600">{page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading || submitting}
            className="text-sm px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  );
}
