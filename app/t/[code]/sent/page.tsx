import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listSentRequests } from '@/domain/request/list-sent';
import { ProgressBar } from '@/ui/components/progress-bar';
import Link from 'next/link';

export const runtime = 'nodejs';

export default async function SentRequestsPage({
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

  const page = Math.max(1, Number(pageStr) || 1);
  const result = await listSentRequests(
    appPool(),
    { userId: session.userId, tenantId: session.tenantId, isTenantAdmin: false, isTenantWideRequester: false },
    { filter: filter as 'all' | 'in_progress' | 'done', q, page, pageSize: 20 },
  );

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-4">📤 送信した依頼</h1>

      <div className="flex gap-0 border-b-2 border-gray-200 mb-4">
        <Link href={`/t/${code}/sent?filter=all`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'all' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}>すべて</Link>
        <Link href={`/t/${code}/sent?filter=in_progress`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'in_progress' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}>進行中</Link>
        <Link href={`/t/${code}/sent?filter=done`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'done' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}>完了</Link>
      </div>

      <div className="space-y-2">
        {result.items.length === 0 && (
          <p className="text-gray-500 text-center py-8">送信した依頼はありません</p>
        )}
        {result.items.map((item) => (
          <Link key={item.id} href={`/t/${code}/requests/${item.id}`}
            className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 no-underline">
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="font-medium text-gray-900 truncate">{item.title}</span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.overdueCount > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full">
                    ⚠️ 期限切れ {item.overdueCount}
                  </span>
                )}
                <span className="text-xs text-gray-500">{item.done}/{item.total}</span>
              </div>
            </div>
            <ProgressBar
              counts={{
                unopened: item.unopened,
                opened: item.opened,
                responded: item.responded,
                unavailable: item.unavailable,
                other: item.other,
              }}
              total={item.total}
            />
            <div className="flex gap-3 mt-2 text-xs text-gray-500">
              {item.dueAt && (
                <span>締切: {new Date(item.dueAt).toLocaleDateString('ja-JP')}</span>
              )}
              <span>未開封 {item.unopened}</span>
              <span>対応済み {item.responded}</span>
            </div>
          </Link>
        ))}
      </div>

      {result.total > page * 20 && (
        <div className="text-center mt-4">
          <Link href={`/t/${code}/sent?filter=${filter}&page=${page + 1}`}
            className="text-blue-600 text-sm hover:underline">
            もっと見る
          </Link>
        </div>
      )}
    </div>
  );
}
