import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Bell,
  Building2,
  ScrollText,
  Settings,
  TriangleAlert,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { getDashboardStats } from '@/domain/admin/dashboard';
import { PageHeader } from '@/ui/components/page-header';

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
      <PageHeader
        icon={<Settings />}
        title="管理"
        description="テナント全体のユーザー・組織・依頼・通知をまとめて管理します。"
      />

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
          sub="active のみ。archived も含めて表示するには「組織管理」へ"
        />
        <StatCard
          href={`/t/${code}/admin/groups`}
          title="グループ"
          primary={`${stats.groups.total} 件`}
          sub={`NudgeFlow ${stats.groups.nudge} / KC ${stats.groups.keycloak}`}
        />
        <StatCard
          href={`/t/${code}/admin/sent?filter=in_progress`}
          title="進行中の依頼"
          primary={`${stats.requests.active} 件`}
          sub="テナント全体の status='active'"
        />
        <StatCard
          href={`/t/${code}/admin/sent?filter=in_progress`}
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

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-700">管理メニュー</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AdminMenuCard
            href={`/t/${code}/admin/users`}
            icon={Users}
            title="ユーザー管理"
            description="一覧・主所属・ロールの編集"
          />
          <AdminMenuCard
            href={`/t/${code}/admin/groups`}
            icon={UserRound}
            title="グループ管理"
            description="テナント全体のグループ作成・編集"
          />
          <AdminMenuCard
            href={`/t/${code}/admin/orgs`}
            icon={Building2}
            title="組織管理"
            description="組織の作成・アーカイブ"
          />
          <AdminMenuCard
            href={`/t/${code}/audit?from=admin`}
            icon={ScrollText}
            title="監査ログ"
            description="操作履歴の確認"
          />
          <AdminMenuCard
            href={`/t/${code}/settings/notification`}
            icon={Bell}
            title="通知設定"
            description="SMTP / Teams / Slack の設定"
          />
          <AdminMenuCard
            href={`/t/${code}/admin/settings/positions`}
            icon={UserRound}
            title="職位と管理職"
            description="管理職とみなす職位 (KC 同期)"
          />
          <AdminMenuCard
            href={`/t/${code}/admin/failed-notifications`}
            icon={TriangleAlert}
            title="失敗通知"
            description="配信失敗した通知の手動再送"
          />
        </div>
      </section>
    </div>
  );
}

function StatCard({
  href, title, primary, sub, tone = 'normal',
}: {
  href?: string; title: string; primary: string; sub?: string;
  tone?: 'normal' | 'warn';
}) {
  const className =
    'block bg-white rounded-lg border border-gray-200 p-5 transition-all'
    + (href ? ' hover:border-primary/30 hover:shadow-sm' : '');
  const inner = (
    <>
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className={tone === 'warn' && primary !== '0 件' ? 'text-2xl font-bold text-orange-600' : 'text-2xl font-bold text-gray-900'}>
        {primary}
      </p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </>
  );
  return href
    ? <Link href={href} className={className}>{inner}</Link>
    : <div className={className}>{inner}</div>;
}

function AdminMenuCard({
  href, icon: Icon, title, description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 p-4 rounded-lg border border-gray-200 bg-white transition-all hover:border-primary/40 hover:bg-emerald-50/40 hover:shadow-sm no-underline"
    >
      <span className="shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md bg-primary/10 text-primary group-hover:bg-primary/15">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </Link>
  );
}
