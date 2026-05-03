'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

type TenantDetail = {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'suspended';
  keycloakRealm: string;
  keycloakIssuerUrl: string;
  syncEnabled: boolean;
  syncConfig: {
    userSourceType: 'keycloak' | 'csv' | 'none';
    orgSourceType: 'keycloak' | 'csv' | 'none';
    orgGroupPrefix: string | null;
    intervalMinutes: number;
    hasClientId: boolean;
    hasClientSecret: boolean;
  } | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export function TenantEditor({ tenant }: { tenant: TenantDetail }) {
  const router = useRouter();

  // basic
  const [name, setName] = useState(tenant.name);
  const [realm, setRealm] = useState(tenant.keycloakRealm);
  const [issuer, setIssuer] = useState(tenant.keycloakIssuerUrl);
  const [status, setStatus] = useState<'active' | 'suspended'>(tenant.status);

  // sync config
  const sc = tenant.syncConfig;
  const [syncEnabled, setSyncEnabled] = useState(sc?.userSourceType ? tenant.syncEnabled : false);
  const [orgSource, setOrgSource] = useState<'keycloak' | 'none'>(sc?.orgSourceType === 'keycloak' ? 'keycloak' : 'none');
  const [orgPrefix, setOrgPrefix] = useState(sc?.orgGroupPrefix ?? '/組織');
  const [interval, setInterval] = useState<number>(sc?.intervalMinutes ?? 60);
  const [clientId, setClientId] = useState<string | null>(null);   // null = unchanged, string = override
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSave() {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const body: Record<string, unknown> = {
        name, keycloakRealm: realm, keycloakIssuerUrl: issuer, status,
        syncConfig: {
          enabled: syncEnabled,
          userSourceType: 'keycloak',
          orgSourceType: orgSource,
          orgGroupPrefix: orgSource === 'keycloak' ? orgPrefix : null,
          intervalMinutes: interval,
          ...(clientId !== null ? { syncClientId: clientId } : {}),
          ...(clientSecret !== null ? { syncClientSecret: clientSecret } : {}),
        },
      };
      const res = await fetch(`/root/api/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setSuccess('保存しました');
      setClientId(null);
      setClientSecret(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '予期しないエラー');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="基本設定">
        <Field label="表示名">
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </Field>
        <Field label="ステータス">
          <select
            value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="active">active (利用可)</option>
            <option value="suspended">suspended (停止中)</option>
          </select>
        </Field>
      </Section>

      <Section title="Keycloak 認証設定">
        <Field label="Realm">
          <input
            type="text" value={realm} onChange={(e) => setRealm(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
        </Field>
        <Field label="Issuer URL">
          <input
            type="url" value={issuer} onChange={(e) => setIssuer(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
          />
        </Field>
      </Section>

      <Section title="Keycloak 同期設定">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={syncEnabled} onChange={(e) => setSyncEnabled(e.target.checked)} className="rounded border-gray-300" />
          同期を有効にする
        </label>
        <Field label="組織同期">
          <select
            value={orgSource} onChange={(e) => setOrgSource(e.target.value as 'keycloak' | 'none')}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="none">組織は同期しない</option>
            <option value="keycloak">Keycloak グループから同期</option>
          </select>
        </Field>
        {orgSource === 'keycloak' && (
          <Field label="組織グループの prefix" hint="このパス配下のグループを組織として取り込む（例: /組織）">
            <input
              type="text" value={orgPrefix} onChange={(e) => setOrgPrefix(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
            />
          </Field>
        )}
        <Field label="同期間隔（分）">
          <input
            type="number" min={5} value={interval} onChange={(e) => setInterval(Number(e.target.value))}
            className="w-24 border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Sync Client ID">
          <SecretField hasExisting={sc?.hasClientId ?? false} value={clientId} onChange={setClientId} />
        </Field>
        <Field label="Sync Client Secret">
          <SecretField hasExisting={sc?.hasClientSecret ?? false} value={clientSecret} onChange={setClientSecret} />
        </Field>
        {tenant.lastSyncAt && (
          <p className="text-xs text-gray-500">
            最終同期: {new Date(tenant.lastSyncAt).toLocaleString('ja-JP')}
          </p>
        )}
        {tenant.lastSyncError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            最終エラー: {tenant.lastSyncError}
          </p>
        )}
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={busy}>{busy ? '保存中...' : '保存'}</Button>
        {success && <span className="text-sm text-green-600">{success}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
      <h2 className="text-sm font-medium text-gray-700">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

function SecretField({
  hasExisting, value, onChange,
}: {
  hasExisting: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (value === null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{hasExisting ? '●●●●●●' : '(未設定)'}</span>
        <button
          type="button" onClick={() => onChange('')}
          className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          {hasExisting ? '変更' : '設定'}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)}
        className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
        autoComplete="off"
      />
      <button
        type="button" onClick={() => onChange(null)}
        className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
      >
        キャンセル
      </button>
    </div>
  );
}
