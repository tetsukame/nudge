import Link from 'next/link';
import { requireRootSession } from '@/auth/root-guard';
import { adminPool } from '@/db/pools';
import { listTenants } from '@/domain/platform/tenants';
import { cn } from '@/lib/utils';

export const runtime = 'nodejs';

function fmt(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

export default async function TenantListPage() {
  await requireRootSession();
  const items = await listTenants(adminPool());

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">🏢 テナント一覧</h1>
        <Link
          href="/root/tenants/new"
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          ➕ テナント追加
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-center text-sm text-gray-500 py-12">テナントが登録されていません。</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">code</th>
                <th className="px-3 py-2 font-medium">名前</th>
                <th className="px-3 py-2 font-medium">状態</th>
                <th className="px-3 py-2 font-medium">KC realm</th>
                <th className="px-3 py-2 font-medium w-20">ユーザー数</th>
                <th className="px-3 py-2 font-medium w-32">最終同期</th>
                <th className="px-3 py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">{t.code}</td>
                  <td className="px-3 py-2 text-gray-900">{t.name}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded border',
                      t.status === 'active'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : 'bg-gray-100 text-gray-500 border-gray-300',
                    )}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{t.keycloakRealm}</td>
                  <td className="px-3 py-2 text-gray-600">{t.userCount}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {t.syncEnabled ? (
                      <>
                        {fmt(t.lastSyncAt)}
                        {t.lastSyncError && (
                          <span className="ml-1 text-red-600" title={t.lastSyncError}>⚠️</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">未設定</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/root/tenants/${t.id}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      編集 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
