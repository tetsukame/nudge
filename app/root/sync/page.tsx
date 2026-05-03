import { requireRootSession } from '@/auth/root-guard';
import { adminPool } from '@/db/pools';
import { listSyncLog } from '@/domain/platform/sync';
import { listTenants } from '@/domain/platform/tenants';
import { SyncRunner } from '@/ui/components/sync-runner';
import { SyncLogTable } from '@/ui/components/sync-log-table';

export const runtime = 'nodejs';

export default async function RootSyncPage() {
  await requireRootSession();
  const [tenants, log] = await Promise.all([
    listTenants(adminPool()),
    listSyncLog(adminPool(), 100),
  ]);

  // Sync 設定が enabled で client_id/secret が設定済みのテナントのみ実行可
  const runnableTenants = tenants
    .filter((t) => t.syncEnabled)
    .map((t) => ({ id: t.id, code: t.code, name: t.name, lastSyncAt: t.lastSyncAt, lastSyncError: t.lastSyncError }));

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">🔄 同期実行 / ログ</h1>

      <SyncRunner tenants={runnableTenants} />

      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-sm font-medium text-gray-700">最近の同期実行履歴（直近 100 件）</h2>
        </div>
        <SyncLogTable items={log} />
      </div>
    </div>
  );
}
