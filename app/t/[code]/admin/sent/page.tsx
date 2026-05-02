import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listSentRequests } from '@/domain/request/list-sent';
import { ProgressBar } from '@/ui/components/progress-bar';

export const runtime = 'nodejs';

export default async function AdminSentPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const filter = sp.filter ?? 'in_progress';
  const q = sp.q;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const result = await listSentRequests(
    appPool(),
    {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: true,
      isTenantWideRequester: false,
    },
    { filter: filter as 'all' | 'in_progress' | 'done', q, page, pageSize: 20, tenantWide: true },
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <Link
        href={`/t/${code}/admin`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 管理に戻る
      </Link>
      <h1 className="text-xl font-bold text-gray-900">📤 テナント全体の依頼</h1>
      <p className="text-sm text-gray-600">
        テナント内のすべての依頼（送信者を問わず）を一覧表示します。
      </p>

      <div className="flex gap-0 border-b-2 border-gray-200 mb-2">
        <Link
          href={`/t/${code}/admin/sent?filter=all`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'all' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          すべて ({result.total})
        </Link>
        <Link
          href={`/t/${code}/admin/sent?filter=in_progress`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'in_progress' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          進行中
        </Link>
        <Link
          href={`/t/${code}/admin/sent?filter=done`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'done' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          完了
        </Link>
      </div>

      <div className="space-y-2">
        {result.items.length === 0 && (
          <p className="text-gray-500 text-center py-8">該当する依頼はありません</p>
        )}
        {result.items.map((item) => (
          <Link
            key={item.id}
            href={`/t/${code}/requests/${item.id}`}
            className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 no-underline"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{item.title}</p>
                {item.createdByName && (
                  <p className="text-xs text-gray-500 mt-0.5">送信者: {item.createdByName}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
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
                notNeeded: item.notNeeded,
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
          <Link
            href={`/t/${code}/admin/sent?filter=${filter}&page=${page + 1}`}
            className="text-blue-600 text-sm hover:underline"
          >
            もっと見る
          </Link>
        </div>
      )}
    </div>
  );
}
