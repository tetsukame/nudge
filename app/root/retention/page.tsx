import { requireRootSession } from '@/auth/root-guard';
import { adminPool } from '@/db/pools';
import { listRetentionSummary } from '@/domain/platform/retention';

export const runtime = 'nodejs';

const TABLE_LABEL: Record<string, string> = {
  notification: '通知履歴',
  audit_log: '監査ログ',
  assignment_status_history: '対応経過履歴',
  sync_log: '同期ログ',
};

export default async function RootRetentionPage() {
  await requireRootSession();
  const rows = await listRetentionSummary(adminPool());

  // tenant ごとにグルーピング
  const byTenant = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byTenant.get(r.tenantCode) ?? [];
    arr.push(r);
    byTenant.set(r.tenantCode, arr);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">🗄 Retention 実行状況</h1>
      <p className="text-sm text-gray-600">
        各テナントの retention_config 設定と retention_log の実績を集計表示します。
        worker tick で 1 時間ごとに実行されています。
      </p>

      {byTenant.size === 0 && (
        <p className="text-sm text-gray-500">テナントが登録されていません。</p>
      )}

      {Array.from(byTenant.entries()).map(([code, list]) => {
        const enabled = list.some((r) => r.enabled);
        const hardEnabled = list.some((r) => r.hardDeleteEnabled);
        const tenantName = list[0]?.tenantName ?? code;
        return (
          <section key={code} className="bg-white rounded-lg border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-3 flex-wrap">
              <h2 className="text-sm font-medium text-gray-900">
                {tenantName} <span className="text-gray-400">({code})</span>
              </h2>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${
                enabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-gray-50 border-gray-300 text-gray-600'
              }`}>
                {enabled ? '有効' : '無効'}
              </span>
              {hardEnabled && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border bg-amber-50 border-amber-300 text-amber-800">
                  物理削除 ON
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">テーブル</th>
                    <th className="text-right px-4 py-2 font-medium">論理削除 累計</th>
                    <th className="text-right px-4 py-2 font-medium">物理削除 累計</th>
                    <th className="text-left px-4 py-2 font-medium">最終論理削除</th>
                    <th className="text-left px-4 py-2 font-medium">最終物理削除</th>
                    <th className="text-left px-4 py-2 font-medium">最終エラー</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.tableName} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-gray-900">
                        {TABLE_LABEL[r.tableName] ?? r.tableName}
                        <span className="ml-2 text-xs text-gray-400">{r.tableName}</span>
                      </td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.totalSoftRows.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{r.totalHardRows.toLocaleString()}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {r.lastSoftAt ? new Date(r.lastSoftAt).toLocaleString('ja-JP') : '—'}
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        {r.lastHardAt ? new Date(r.lastHardAt).toLocaleString('ja-JP') : '—'}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {r.lastErrorMessage ? (
                          <span className="text-red-700">{r.lastErrorMessage}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
