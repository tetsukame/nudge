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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/t/${tenantCode}/api/users/search?q=${encodeURIComponent(query)}`,
        );
        if (res.ok) {
          const data = await res.json() as UserResult[];
          setResults(data);
        }
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tenantCode]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? 'ユーザーを検索（名前・メール）'}
        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {loading && (
        <p className="text-xs text-gray-500 px-1">検索中...</p>
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

      {!loading && query.trim() && results.length === 0 && (
        <p className="text-xs text-gray-500 px-1">該当するユーザーが見つかりません。</p>
      )}
    </div>
  );
}
