'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type OrgOption = { id: string; name: string };
type UserItem = {
  id: string;
  displayName: string;
  email: string;
  orgUnitName: string | null;
};

type Props = {
  tenantCode: string;
  groupId: string;
  existingUserIds: string[];
  orgUnits: OrgOption[];
};

export function AddMembersForm({ tenantCode, groupId, existingUserIds, orgUnits }: Props) {
  const router = useRouter();
  const existingSet = new Set(existingUserIds);

  const [query, setQuery] = useState('');
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [users, setUsers] = useState<UserItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        params.set('q', query);
        if (orgUnitId) params.set('orgUnitId', orgUnitId);
        params.set('limit', '200');
        const res = await fetch(`/t/${tenantCode}/api/users/search?${params.toString()}`);
        if (!res.ok) throw new Error(`エラー (${res.status})`);
        const data = await res.json();
        const items: UserItem[] = Array.isArray(data) ? data : data.items ?? [];
        setUsers(items);
      } catch (err) {
        setError(err instanceof Error ? err.message : '取得に失敗しました');
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, orgUnitId, tenantCode]);

  const addable = users.filter((u) => !existingSet.has(u.id));
  const allSelected = addable.length > 0 && addable.every((u) => selected.has(u.id));

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(addable.map((u) => u.id)));
    }
  }

  async function handleSubmit() {
    if (selected.size === 0) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      router.push(`/t/${tenantCode}/groups/${groupId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[14rem_1fr] gap-6">
      {/* Left: filters */}
      <aside className="bg-white rounded-lg border border-gray-200 p-4 space-y-4 h-fit">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700" htmlFor="filter-q">名前 / メール</label>
          <input
            id="filter-q"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="検索..."
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-700" htmlFor="filter-org">所属</label>
          <select
            id="filter-org"
            value={orgUnitId}
            onChange={(e) => setOrgUnitId(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">（すべて）</option>
            {orgUnits.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-gray-500">
          選択中: <span className="font-semibold text-gray-900">{selected.size}</span> 名
        </p>
      </aside>

      {/* Right: users list */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={addable.length === 0}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">表示分を全て選択</span>
            <span className="text-xs text-gray-500">（{addable.length} / {users.length} 名が追加可能）</span>
          </label>
          {loading && <span className="text-xs text-gray-500">読み込み中...</span>}
        </div>
        {error && <p className="text-sm text-red-600 px-4 py-2 border-b border-red-100 bg-red-50">{error}</p>}
        {users.length === 0 && !loading ? (
          <p className="text-sm text-gray-500 text-center py-12">該当ユーザーが見つかりません。</p>
        ) : (
          <ul className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
            {users.map((u) => {
              const already = existingSet.has(u.id);
              const checked = selected.has(u.id);
              return (
                <li key={u.id}>
                  <label
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer',
                      already && 'opacity-50 cursor-not-allowed bg-gray-50',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={already || checked}
                      disabled={already}
                      onChange={() => toggle(u.id)}
                      className="rounded border-gray-300"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{u.displayName}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {u.email}
                        {u.orgUnitName && ` · ${u.orgUnitName}`}
                      </p>
                    </div>
                    {already && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">
                        メンバー登録済
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
          <Button onClick={handleSubmit} disabled={submitting || selected.size === 0}>
            {submitting ? '追加中...' : `${selected.size} 名を追加`}
          </Button>
        </div>
      </div>
    </div>
  );
}
