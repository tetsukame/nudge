'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props = { tenantCode: string };

export function RescueLoginForm({ tenantCode }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/t/${tenantCode}/api/rescue-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `エラー (${res.status})`);
      }
      const redirectTo = (data as { redirectTo?: string }).redirectTo ?? `/t/${tenantCode}/`;
      window.location.href = redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラー');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs text-gray-600" htmlFor="rescue-email">
          Platform admin メールアドレス
        </label>
        <Input
          id="rescue-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs text-gray-600" htmlFor="rescue-password">
          パスワード
        </label>
        <Input
          id="rescue-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
      </div>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      <Button
        onClick={() => void submit()}
        disabled={busy || !email || !password}
      >
        {busy ? '認証中...' : '緊急ログイン'}
      </Button>
    </div>
  );
}
