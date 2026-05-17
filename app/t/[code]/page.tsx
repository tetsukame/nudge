import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Inbox, Send, Users } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { getMyDashboard } from '@/domain/dashboard/my-dashboard';
import { PageHeader } from '@/ui/components/page-header';

export const runtime = 'nodejs';

export default async function TenantDashboard({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const d = await getMyDashboard(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: false,
    isTenantWideRequester: false,
  });

  const inboxPending = d.inbox.unopened + d.inbox.opened;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <PageHeader
        title={`こんにちは、${session.displayName} さん`}
        description="今のあなたの状況サマリーです。"
      />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-gray-700">自分宛の依頼</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="未対応" value={inboxPending} href={`/t/${code}/requests`} />
          <StatCard label="未開封" value={d.inbox.unopened} href={`/t/${code}/requests`} />
          <StatCard
            label="期限超過"
            value={d.inbox.overdue}
            tone={d.inbox.overdue > 0 ? 'warn' : 'normal'}
            href={`/t/${code}/requests`}
          />
          <StatCard
            label="期限が近い"
            value={d.inbox.dueSoon}
            tone={d.inbox.dueSoon > 0 ? 'warn' : 'normal'}
            href={`/t/${code}/requests`}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-gray-700">送信した依頼</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="進行中"
            value={d.sent.inProgress}
            href={`/t/${code}/sent?filter=in_progress`}
          />
          <StatCard
            label="期限超過を含む"
            value={d.sent.overdueRequests}
            tone={d.sent.overdueRequests > 0 ? 'warn' : 'normal'}
            href={`/t/${code}/sent?filter=in_progress`}
          />
        </div>
      </section>

      {d.subordinate.isManager && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-gray-700">部下の未処理</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="未処理（配下合計）"
              value={d.subordinate.pending}
              href={`/t/${code}/subordinates`}
            />
            <StatCard
              label="期限超過（配下）"
              value={d.subordinate.overdue}
              tone={d.subordinate.overdue > 0 ? 'warn' : 'normal'}
              href={`/t/${code}/subordinates?overdue=1`}
            />
          </div>
        </section>
      )}

      <section className="flex flex-wrap gap-2">
        <Link
          href={`/t/${code}/requests`}
          className="text-sm px-3 py-1.5 rounded-md border border-border bg-white hover:border-primary/40 hover:bg-emerald-50/40 transition-colors no-underline text-foreground"
        >
          📥 未対応を見る
        </Link>
        <Link
          href={`/t/${code}/requests/new`}
          className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors no-underline"
        >
          ＋ 新規作成
        </Link>
        <Link
          href={`/t/${code}/sent`}
          className="text-sm px-3 py-1.5 rounded-md border border-border bg-white hover:border-primary/40 hover:bg-emerald-50/40 transition-colors no-underline text-foreground"
        >
          📤 送信した依頼
        </Link>
      </section>
    </div>
  );
}

function StatCard({
  label, value, href, tone = 'normal',
}: {
  label: string;
  value: number;
  href: string;
  tone?: 'normal' | 'warn';
}) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-primary/30 hover:shadow-sm transition-all no-underline"
    >
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p
        className={
          tone === 'warn' && value > 0
            ? 'text-2xl font-bold text-orange-600'
            : 'text-2xl font-bold text-gray-900'
        }
      >
        {value}
      </p>
    </Link>
  );
}
