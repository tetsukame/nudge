'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function TeamsTabPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const code = params?.code;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    void (async () => {
      try {
        const teams = await import('@microsoft/teams-js');
        await teams.app.initialize();
        const entraToken = await teams.authentication.getAuthToken();
        if (cancelled) return;
        const res = await fetch(`/t/${code}/teams/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entraToken }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as {
            error?: string;
            detail?: string;
          };
          throw new Error(json.detail ?? json.error ?? `Auth failed: ${res.status}`);
        }
        if (cancelled) return;
        router.replace(`/t/${code}/`);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="bg-white border border-red-200 rounded-md p-5 max-w-md">
          <h1 className="text-lg font-semibold text-red-700 mb-2">サインインに失敗しました</h1>
          <p className="text-sm text-gray-700 mb-3 whitespace-pre-wrap">{error}</p>
          <p className="text-xs text-gray-500">
            このページは Microsoft Teams 内でのみ動作します。Teams の管理者に
            Entra アプリ登録および Keycloak Token Exchange の設定を確認してもらってください。
            設定手順は{' '}
            <a
              href="https://github.com/tetsukame/nudge/blob/main/docs/teams-integration.md"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              docs/teams-integration.md
            </a>{' '}
            参照。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-gray-600">Nudge にサインイン中...</p>
    </div>
  );
}
