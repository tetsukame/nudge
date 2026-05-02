import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { getDashboardStats } from '@/domain/admin/dashboard';

export const runtime = 'nodejs';

export default async function AdminDashboardPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const stats = await getDashboardStats(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true, // layout guard already enforced
    isTenantWideRequester: false,
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">⚙️ 管理</h1>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          href={`/t/${code}/admin/users`}
          title="ユーザー"
          primary={`${stats.users.active} 名`}
          sub={`active / 総 ${stats.users.total} 名（inactive ${stats.users.inactive}）`}
        />
        <StatCard
          href={`/t/${code}/admin/orgs`}
          title="組織"
          primary={`${stats.orgUnits} 件`}
          sub="org_unit テーブル"
        />
        <StatCard
          href={`/t/${code}/groups`}
          title="グループ"
          primary={`${stats.groups.total} 件`}
          sub={`Nudge ${stats.groups.nudge} / KC ${stats.groups.keycloak}`}
        />
        <StatCard
          href={`/t/${code}/sent`}
          title="進行中の依頼"
          primary={`${stats.requests.active} 件`}
          sub="status='active'"
        />
        <StatCard
          href={`/t/${code}/admin/audit`}
          title="未対応 assignment"
          primary={`${stats.assignments.pending} 件`}
          sub={
            stats.assignments.overdue > 0
              ? `うち期限超過 ${stats.assignments.overdue} 件`
              : '全て期限内'
          }
          tone={stats.assignments.overdue > 0 ? 'warn' : 'normal'}
        />
        <StatCard
          href={`/t/${code}/admin/failed-notifications`}
          title="失敗通知"
          primary={`${stats.notifications.failed} 件`}
          sub="リトライ上限到達 (要再送判断)"
          tone={stats.notifications.failed > 0 ? 'warn' : 'normal'}
        />
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-5 space-y-2">
        <h2 className="text-sm font-medium text-gray-700">管理メニュー</h2>
        <ul className="text-sm space-y-1">
          <AdminLink href={`/t/${code}/admin/users`} label="👥 ユーザー管理（一覧 / 主所属 / ロール）" />
          <AdminLink href={`/t/${code}/admin/audit`} label="📋 監査ログ" />
          <AdminLink href={`/t/${code}/admin/failed-notifications`} label="⚠️ 失敗通知の手動再送" />
          <AdminLink href={`/t/${code}/settings/notification`} label="📨 通知設定 (SMTP / Teams / Slack)" />
        </ul>
      </section>
    </div>
  );
}

function StatCard({
  href, title, primary, sub, tone = 'normal',
}: {
  href: string; title: string; primary: string; sub?: string;
  tone?: 'normal' | 'warn';
}) {
  return (
    <Link
      href={href}
      className="block bg-white rounded-lg border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className={tone === 'warn' && primary !== '0 件' ? 'text-2xl font-bold text-orange-600' : 'text-2xl font-bold text-gray-900'}>
        {primary}
      </p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </Link>
  );
}

function AdminLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link href={href} className="text-blue-600 hover:underline">{label}</Link>
    </li>
  );
}
