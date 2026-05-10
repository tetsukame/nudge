import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { listSubordinateRequests } from '@/domain/request/list-subordinate';
import { RequestCard } from '@/ui/components/request-card';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default async function SubordinatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const { code } = await params;
  const { filter = 'all', q, page: pageStr = '1' } = await searchParams;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) return <div>Unauthorized</div>;

  // Manager check
  const isManager = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM org_unit_manager WHERE user_id = $1 LIMIT 1`,
      [session.userId],
    );
    return rows.length > 0;
  });
  if (!isManager) {
    redirect(`/t/${code}/requests`);
  }

  const page = Math.max(1, Number(pageStr) || 1);
  const result = await listSubordinateRequests(
    appPool(),
    { userId: session.userId, tenantId: session.tenantId, isTenantAdmin: false, isTenantWideRequester: false },
    { filter: filter as 'all' | 'in_progress' | 'done', q, page, pageSize: 20 },
  );

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-4">👥 部下の依頼</h1>

      <div className="flex gap-0 border-b-2 border-gray-200 mb-4">
        <Link href={`/t/${code}/subordinates?filter=all`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'all' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>すべて</Link>
        <Link href={`/t/${code}/subordinates?filter=in_progress`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'in_progress' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>進行中</Link>
        <Link href={`/t/${code}/subordinates?filter=done`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'done' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>完了</Link>
      </div>

      <div className="space-y-2">
        {result.items.length === 0 && (
          <p className="text-gray-500 text-center py-8">部下の依頼はありません</p>
        )}
        {result.items.map((item) => (
          <RequestCard
            key={item.id}
            href={`/t/${code}/requests/${item.id}`}
            title={item.title}
            dueLabel={
              item.dueAt
                ? `締切: ${new Date(item.dueAt).toLocaleDateString('ja-JP')}`
                : undefined
            }
            meta={[
              { label: '配下未開封', value: item.unopened },
              { label: '配下対応済み', value: item.responded },
            ]}
            progress={{
              done: item.done,
              total: item.total,
              overdue: item.overdueCount,
            }}
          />
        ))}
      </div>
    </div>
  );
}
