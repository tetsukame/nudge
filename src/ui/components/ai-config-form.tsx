'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProviderKind = 'dify' | 'openai_compat';

type Initial = {
  enabled: boolean;
  provider: ProviderKind;
  endpoint: string;
  difyAppId: string | null;
  model: string | null;
  systemPrompt: string | null;
  defaultUserPrompt: string | null;
  hasApiKey: boolean;
} | null;

type Props = {
  tenantCode: string;
  initial: Initial;
};

export function AIConfigForm({ tenantCode, initial }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [provider, setProvider] = useState<ProviderKind>(initial?.provider ?? 'openai_compat');
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? '');
  const [difyAppId, setDifyAppId] = useState(initial?.difyAppId ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? '');
  const [defaultUserPrompt, setDefaultUserPrompt] = useState(initial?.defaultUserPrompt ?? '');
  const [apiKey, setApiKey] = useState('');
  const hadKey = !!initial?.hasApiKey;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ title: string; body: string; memo: string } | null>(null);
  const [testError, setTestError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      // apiKey: 空欄かつ既存あり → undefined を送って既存維持
      const apiKeyPayload =
        apiKey === '' && hadKey
          ? undefined
          : apiKey;
      const res = await fetch(`/t/${tenantCode}/api/admin/settings/ai`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          provider,
          endpoint,
          difyAppId: provider === 'dify' ? difyAppId : null,
          model: provider === 'openai_compat' ? model : null,
          systemPrompt: provider === 'openai_compat' ? systemPrompt : null,
          defaultUserPrompt,
          apiKey: apiKeyPayload,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setSaved(true);
      setApiKey('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTestBusy(true);
    setTestResult(null);
    setTestError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/admin/settings/ai/test`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      setTestResult(data as { title: string; body: string; memo: string });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
          />
          <span>このテナントで AI 整形を有効化する</span>
        </label>

        <div className="space-y-2">
          <span className="block text-sm font-medium text-gray-700">プロバイダ</span>
          <div className="flex flex-col gap-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={provider === 'openai_compat'}
                onChange={() => setProvider('openai_compat')}
                disabled={busy}
              />
              OpenAI 互換 API（LM Studio / Ollama / OpenAI / OpenRouter 等）
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={provider === 'dify'}
                onChange={() => setProvider('dify')}
                disabled={busy}
              />
              Dify Workflow
            </label>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-600" htmlFor="ai-endpoint">
            エンドポイント
          </label>
          <Input
            id="ai-endpoint"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={
              provider === 'dify'
                ? 'https://api.dify.ai'
                : 'http://host.docker.internal:1234/v1'
            }
            disabled={busy}
          />
        </div>

        {provider === 'dify' && (
          <div className="space-y-1">
            <label className="text-xs text-gray-600" htmlFor="ai-dify-app">
              Dify App ID (workflow id)
            </label>
            <Input
              id="ai-dify-app"
              value={difyAppId}
              onChange={(e) => setDifyAppId(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {provider === 'openai_compat' && (
          <div className="space-y-1">
            <label className="text-xs text-gray-600" htmlFor="ai-model">
              モデル名
            </label>
            <Input
              id="ai-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="例: qwen2.5-coder-7b / gpt-4o-mini"
              disabled={busy}
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs text-gray-600" htmlFor="ai-api-key">
            API Key{provider === 'openai_compat' ? '（LM Studio 等は空欄可）' : ''}
          </label>
          <Input
            id="ai-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hadKey ? '保存済み（変更時のみ入力）' : ''}
            disabled={busy}
          />
        </div>

        {provider === 'openai_compat' && (
          <div className="space-y-1">
            <label className="text-xs text-gray-600" htmlFor="ai-system-prompt">
              システムプロンプト（任意・空ならビルトインを使用）
            </label>
            <textarea
              id="ai-system-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={6}
              className="w-full border border-gray-300 rounded-md p-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={busy}
            />
          </div>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-emerald-700">保存しました。</p>
        )}

        <Button onClick={() => void save()} disabled={busy}>
          {busy ? '保存中...' : '保存'}
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-medium text-gray-900">疎通テスト</h2>
        <p className="text-xs text-gray-600">
          保存済みの設定でテスト送信します。固定メモ「アンケート回答依頼」を送信し、
          整形された title / body が返ってくれば疎通 OK。
        </p>
        <Button variant="outline" onClick={() => void test()} disabled={testBusy}>
          {testBusy ? '送信中...' : 'テスト送信'}
        </Button>
        {testError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {testError}
          </p>
        )}
        {testResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-2 text-sm">
            <div>
              <div className="text-xs text-emerald-800 font-medium">送信メモ</div>
              <div className="text-gray-800">{testResult.memo}</div>
            </div>
            <div>
              <div className="text-xs text-emerald-800 font-medium">title</div>
              <div className="text-gray-900 font-medium">{testResult.title}</div>
            </div>
            <div>
              <div className="text-xs text-emerald-800 font-medium">body</div>
              <pre className="text-gray-800 whitespace-pre-wrap font-sans">{testResult.body}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
