'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function NewTenantPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [realm, setRealm] = useState('');
  const [issuer, setIssuer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/root/api/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          keycloakRealm: realm.trim(),
          keycloakIssuerUrl: issuer.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      const { id } = await res.json() as { id: string };
      router.push(`/root/tenants/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <Link href="/root/tenants" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        ← テナント一覧に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">🏢 テナント追加</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <Field label="code（URL に使う識別子）" hint="2〜30 文字の英小文字・数字・ハイフン">
          <input
            type="text" required value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="例: city-tokyo"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="表示名">
          <input
            type="text" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="例: 東京都"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Keycloak Realm">
          <input
            type="text" required value={realm} onChange={(e) => setRealm(e.target.value)}
            placeholder="例: city-tokyo"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Keycloak Issuer URL">
          <input
            type="url" required value={issuer} onChange={(e) => setIssuer(e.target.value)}
            placeholder="例: https://kc.example.com/realms/city-tokyo"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
        </Field>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <Link href="/root/tenants" className="text-sm px-3 py-2 border border-gray-300 rounded-md hover:bg-gray-50">
            キャンセル
          </Link>
          <button
            type="submit" disabled={busy}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? '作成中...' : '作成'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
