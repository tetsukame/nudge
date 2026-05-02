'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type FlatOrg = { id: string; name: string; level: number };

type UserRow = {
  id: string;
  displayName: string;
  email: string;
  status: 'active' | 'inactive';
  primaryOrgUnitName: string | null;
  roles: string[];
  createdAt: string;
};

type Props = {
  tenantCode: string;
  orgUnits: FlatOrg[];
  currentUserId: string;
};

const PAGE_SIZE = 50;

export function AdminUsersBrowser({ tenantCode, orgUnits, currentUserId }: Props) {
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgUnitId) {
      setItems([]);
      setTotal(0);
      return;
    }
    let aborted = false;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    params.set('orgUnitId', orgUnitId);
    params.set('includeDescendants', String(includeDescendants));
    if (q.trim()) params.set('q', q.trim());
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    fetch(`/t/${tenantCode}/api/admin/users?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { items: UserRow[]; total: number }) => {
        if (aborted) return;
        setItems(data.items ?? []);
        setTotal(data.total ?? 0);
      })
      .catch(async (err) => {
        if (aborted) return;
        const msg = err instanceof Response ? (await err.json().catch(() => ({}))).error ?? 'エラー' : 'エラー';
        setError(msg);
        setItems([]);
        setTotal(0);
      })
      .finally(() => { if (!aborted) setLoading(false); });
    return () => { aborted = true; };
  }, [orgUnitId, includeDescendants, q, page, tenantCode]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [orgUnitId, includeDescendants, q]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700" htmlFor="org-select">
              組織を選択 <span className="text-red-500">*</span>
            </label>
            <select
              id="org-select"
              value={orgUnitId}
              onChange={(e) => setOrgUnitId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">（組織を選択してください）</option>
              {orgUnits.map((o) => (
                <option key={o.id} value={o.id}>
                  {'　'.repeat(o.level)}{o.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
            <input
              type="checkbox"
              checked={includeDescendants}
              onChange={(e) => setIncludeDescendants(e.target.checked)}
              className="rounded border-gray-300"
            />
            子組織を含む
          </label>
        </div>
        {orgUnitId && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700" htmlFor="q-input">
              名前 / メール検索
            </label>
            <input
              id="q-input"
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="検索..."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      {!orgUnitId && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800">
          📌 ユーザー一覧を表示するには、まず上で組織を選択してください。
        </div>
      )}

      {orgUnitId && (
        <>
          <div className="flex items-center justify-between text-sm text-gray-600">
            <p>
              該当 <span className="font-semibold text-gray-900">{total}</span> 名
              {totalPages > 1 && ` (ページ ${page} / ${totalPages})`}
            </p>
            {loading && <span className="text-xs text-gray-500">読み込み中...</span>}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {items.length === 0 && !loading && !error ? (
            <p className="text-center text-sm text-gray-500 py-8">該当ユーザーがいません。</p>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-600">
                  <tr>
                    <th className="px-4 py-2 font-medium">表示名</th>
                    <th className="px-4 py-2 font-medium">メール</th>
                    <th className="px-4 py-2 font-medium">主所属</th>
                    <th className="px-4 py-2 font-medium">役割</th>
                    <th className="px-4 py-2 font-medium">状態</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {u.displayName}
                        {u.id === currentUserId && (
                          <span className="ml-1 text-[10px] text-gray-500">(あなた)</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-600">{u.email}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {u.primaryOrgUnitName ?? <span className="text-gray-400">未設定</span>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 && (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                          {u.roles.map((r) => (
                            <span
                              key={r}
                              className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded border',
                                r === 'tenant_admin'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : 'bg-blue-50 text-blue-700 border-blue-200',
                              )}
                            >
                              {r === 'tenant_admin' ? '管理者' : '組織横断'}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded border',
                            u.status === 'active'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : 'bg-gray-100 text-gray-500 border-gray-300',
                          )}
                        >
                          {u.status === 'active' ? 'active' : 'inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/t/${tenantCode}/admin/users/${u.id}`}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          詳細 →
                        </Link>
                      </td>
                    </tr>
                  ))}
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
              <span className="text-sm text-gray-600">
                {page} / {totalPages}
              </span>
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
        </>
      )}
    </div>
  );
}
