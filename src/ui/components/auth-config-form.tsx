'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/ui/components/confirm-dialog';

type ProviderType = 'keycloak' | 'generic-oidc';

type Initial = {
  providerType: ProviderType;
  issuerUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  claimMapping: Record<string, unknown>;
} | null;

type Props = {
  tenantCode: string;
  initial: Initial;
};

type DiscoveryOk = {
  ok: true;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
};

export function AuthConfigForm({ tenantCode, initial }: Props) {
  const router = useRouter();
  const [providerType, setProviderType] = useState<ProviderType>(
    initial?.providerType ?? 'generic-oidc',
  );
  const [issuerUrl, setIssuerUrl] = useState(initial?.issuerUrl ?? '');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [claimMappingText, setClaimMappingText] = useState(
    JSON.stringify(initial?.claimMapping ?? {}, null, 2),
  );
  const hadSecret = !!initial?.hasClientSecret;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [testBusy, setTestBusy] = useState(false);
  const [testOk, setTestOk] = useState<DiscoveryOk | null>(null);
  const [testError, setTestError] = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);

  function parseClaimMappingOrNull(): Record<string, unknown> | null {
    const t = claimMappingText.trim();
    if (t === '') return {};
    try {
      const j = JSON.parse(t);
      if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
      return j as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const cm = parseClaimMappingOrNull();
      if (cm === null) {
        throw new Error('claim mapping が JSON として不正です');
      }
      // clientSecret: 空欄かつ既存あり → undefined を送って既存維持
      const secretPayload =
        clientSecret === '' && hadSecret ? undefined : clientSecret;
      const res = await fetch(`/t/${tenantCode}/api/admin/settings/auth`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providerType,
          issuerUrl,
          clientId,
          clientSecret: secretPayload,
          claimMapping: cm,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setSaved(true);
      setClientSecret('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
    }
  }

  async function testDiscovery() {
    setTestBusy(true);
    setTestOk(null);
    setTestError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/settings/auth/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ issuerUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !(data as { ok?: boolean }).ok) {
        throw new Error(
          (data as { error?: string }).error ?? `Discovery 失敗 (${res.status})`,
        );
      }
      setTestOk(data as DiscoveryOk);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setTestBusy(false);
    }
  }

  async function reallyDelete() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/settings/auth`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="space-y-2">
          <span className="block text-sm font-medium text-gray-700">認証プロバイダ</span>
          <div className="flex flex-col gap-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={providerType === 'generic-oidc'}
                onChange={() => setProviderType('generic-oidc')}
                disabled={busy}
              />
              汎用 OIDC (Pocket ID / Authentik / Entra ID 等)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={providerType === 'keycloak'}
                onChange={() => setProviderType('keycloak')}
                disabled={busy}
              />
              Keycloak
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-600" htmlFor="auth-issuer">
            Issuer URL
          </label>
          <Input
            id="auth-issuer"
            value={issuerUrl}
            onChange={(e) => setIssuerUrl(e.target.value)}
            placeholder={
              providerType === 'keycloak'
                ? 'https://kc.example.com/realms/nudge'
                : 'https://pocket-id.example.com'
            }
            disabled={busy}
          />
          <p className="text-xs text-gray-500">
            {`Discovery Endpoint (${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration) が取得できる URL`}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-600" htmlFor="auth-client-id">
            Client ID
          </label>
          <Input
            id="auth-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="nudge-web"
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-600" htmlFor="auth-client-secret">
            Client Secret
          </label>
          <Input
            id="auth-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={hadSecret ? '保存済み（変更時のみ入力）' : ''}
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-600" htmlFor="auth-claim-mapping">
            Claim マッピング (JSON、任意)
          </label>
          <textarea
            id="auth-claim-mapping"
            value={claimMappingText}
            onChange={(e) => setClaimMappingText(e.target.value)}
            rows={10}
            className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={busy}
          />
          <p className="text-xs text-gray-500">
            例:{' '}
            <code>
              {`{"user":{"emailClaim":"email"},"roles":{"claim":"groups","map":{"admins":"tenant_admin"}}}`}
            </code>
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-emerald-700">保存しました。</p>}

        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? '保存中...' : '保存'}
          </Button>
          {initial && (
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              削除して既定に戻す
            </Button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-medium text-gray-900">接続テスト (Discovery)</h2>
        <p className="text-xs text-gray-600">
          入力中の Issuer URL に対して OIDC Discovery を試み、authorization / token
          endpoint が返るか検証します。認証情報は使いません。
        </p>
        <Button variant="outline" onClick={() => void testDiscovery()} disabled={testBusy || !issuerUrl}>
          {testBusy ? '確認中...' : '接続テスト'}
        </Button>
        {testError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {testError}
          </p>
        )}
        {testOk && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-1 text-sm">
            <div>
              <span className="text-xs text-emerald-800 font-medium">issuer: </span>
              <span className="text-gray-900 font-mono">{testOk.issuer}</span>
            </div>
            <div>
              <span className="text-xs text-emerald-800 font-medium">authorization_endpoint: </span>
              <span className="text-gray-900 font-mono">{testOk.authorizationEndpoint}</span>
            </div>
            <div>
              <span className="text-xs text-emerald-800 font-medium">token_endpoint: </span>
              <span className="text-gray-900 font-mono">{testOk.tokenEndpoint}</span>
            </div>
            {testOk.endSessionEndpoint && (
              <div>
                <span className="text-xs text-emerald-800 font-medium">end_session_endpoint: </span>
                <span className="text-gray-900 font-mono">{testOk.endSessionEndpoint}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="認証設定を削除"
        description={
          '削除するとこの tenant は env の OIDC_CLIENT_ID / OIDC_CLIENT_SECRET と ' +
          'tenant.keycloak_issuer_url を使うフォールバック動作に戻ります。' +
          '設定が env 側にも無いと、次回ログインが失敗する可能性があります。'
        }
        confirmLabel="削除する"
        danger
        onConfirm={() => void reallyDelete()}
        busy={busy}
      />
    </div>
  );
}
