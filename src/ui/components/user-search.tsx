'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type UserResult = {
  id: string;
  displayName: string;
  email: string;
  orgUnitName: string | null;
};

type Props = {
  tenantCode: string;
  onSelect: (user: UserResult) => void;
  selectedId?: string | null;
  placeholder?: string;
};

export function UserSearch({ tenantCode, onSelect, selectedId, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load org members on mount (empty query = all visible users)
  useEffect(() => {
    setLoading(true);
    fetch(`/t/${tenantCode}/api/users/search?q=`)
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => {
        const items = Array.isArray(data) ? data : data.items ?? [];
        setResults(items);
        setInitialLoaded(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tenantCode]);

  // Filter/search on query change
  useEffect(() => {
    if (!initialLoaded) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      // Reset to full list
      setLoading(true);
      fetch(`/t/${tenantCode}/api/users/search?q=`)
        .then((res) => res.ok ? res.json() : Promise.reject())
        .then((data) => {
          const items = Array.isArray(data) ? data : data.items ?? [];
          setResults(items);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/t/${tenantCode}/api/users/search?q=${encodeURIComponent(query)}`,
        );
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray(data) ? data : data.items ?? [];
          setResults(items);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tenantCode, initialLoaded]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? '名前・メールで絞り込み'}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {loading && (
        <p className="text-xs text-gray-500 px-1">読み込み中...</p>
      )}

      {!loading && results.length > 0 && (
        <ul className="border border-gray-200 rounded-md divide-y divide-gray-100 bg-white shadow-sm max-h-60 overflow-y-auto">
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => onSelect(user)}
                className={cn(
                  'w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors',
                  selectedId === user.id && 'bg-blue-50 border-l-2 border-blue-500',
                )}
              >
                <p className="text-sm font-medium text-gray-900">{user.displayName}</p>
                <p className="text-xs text-gray-500">
                  {user.email}
                  {user.orgUnitName && ` · ${user.orgUnitName}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && initialLoaded && results.length === 0 && (
        <p className="text-xs text-gray-500 px-1">該当するユーザーが見つかりません。</p>
      )}
    </div>
  );
}
