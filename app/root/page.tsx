import { requireRootSession } from '@/auth/root-guard';
import { adminPool } from '@/db/pools';
import { getPlatformStats } from '@/domain/platform/dashboard';

export const runtime = 'nodejs';

export default async function RootDashboardPage() {
  await requireRootSession();
  const stats = await getPlatformStats(adminPool());

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">📊 プラットフォーム ダッシュボード</h1>
      <p className="text-sm text-gray-600">
        Nudge 全体の運用状況を表示します。テナント業務情報（依頼・コメント等）は表示しません。
      </p>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card title="テナント数 (active)" value={`${stats.tenants.active}`} sub={`総 ${stats.tenants.total}（suspended ${stats.tenants.suspended}）`} />
        <Card title="総ユーザー数 (active)" value={`${stats.totalUsers}`} sub="全テナント横断" />
        <Card title="同期有効テナント" value={`${stats.syncEnabledTenants}`} sub="tenant_sync_config.enabled = true" />
        <Card title="同期実行中" value={`${stats.syncRunningCount}`} sub="sync_log.status='running'" tone={stats.syncRunningCount > 0 ? 'info' : 'normal'} />
        <Card title="24h 以内の同期失敗" value={`${stats.syncFailedRecentCount}`} sub="要確認" tone={stats.syncFailedRecentCount > 0 ? 'warn' : 'normal'} />
      </section>
    </div>
  );
}

function Card({
  title, value, sub, tone = 'normal',
}: {
  title: string; value: string; sub?: string;
  tone?: 'normal' | 'warn' | 'info';
}) {
  const valueColor =
    tone === 'warn' && value !== '0' ? 'text-orange-600'
    : tone === 'info' && value !== '0' ? 'text-blue-600'
    : 'text-gray-900';
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}
