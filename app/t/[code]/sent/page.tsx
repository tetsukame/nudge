import { cookies } from 'next/headers';
import { Send } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listSentRequests } from '@/domain/request/list-sent';
import { PageHeader } from '@/ui/components/page-header';
import { RequestCard } from '@/ui/components/request-card';
import { SentRequestCardActions } from '@/ui/components/sent-card-actions';
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
    {
      filter: filter as 'all' | 'in_progress' | 'done' | 'scheduled',
      q, page, pageSize: 20,
    },
  );

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <PageHeader
        icon={<Send />}
        title="送信した依頼"
        description="あなたが送信した依頼の進捗を確認できます。"
      />

      <div className="flex gap-0 border-b-2 border-gray-200 mb-4">
        <Link href={`/t/${code}/sent?filter=all`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'all' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>すべて</Link>
        <Link href={`/t/${code}/sent?filter=in_progress`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'in_progress' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>進行中</Link>
        <Link href={`/t/${code}/sent?filter=done`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'done' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>完了</Link>
        <Link href={`/t/${code}/sent?filter=scheduled`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'scheduled' ? 'border-b-2 border-primary text-primary' : 'text-gray-500'
          }`}>⏰ 予約中</Link>
      </div>

      <div className="space-y-2">
        {result.items.length === 0 && (
          <p className="text-gray-500 text-center py-8">送信した依頼はありません</p>
        )}
        {result.items.map((item) => {
          const pendingCount = item.total - item.done;
          // NDG-72: 取り消し済みは「🚫 取り消し済み」バッジ + 進捗バーは非表示
          const isCancelled = item.status === 'cancelled';
          // NDG-70: 予約中 (status='draft' && scheduled_at) は「⏰ 予約送信」バッジ
          const isScheduled = item.status === 'draft' && item.scheduledAt != null;
          const scheduledLabel = isScheduled && item.scheduledAt
            ? `送信予定: ${new Date(item.scheduledAt).toLocaleString('ja-JP')}`
            : undefined;
          return (
            <RequestCard
              key={item.id}
              href={`/t/${code}/requests/${item.id}?from=sent`}
              title={item.title}
              dueLabel={
                isScheduled
                  ? scheduledLabel
                  : item.dueAt
                    ? `締切: ${new Date(item.dueAt).toLocaleDateString('ja-JP')}`
                    : undefined
              }
              statusLabel={
                isCancelled ? '🚫 取り消し済み'
                : isScheduled ? '⏰ 予約送信'
                : undefined
              }
              statusVariant={isCancelled || isScheduled ? 'done' : undefined}
              meta={isCancelled || isScheduled ? undefined : [
                { label: '未開封', value: item.unopened },
                { label: '対応済み', value: item.responded },
              ]}
              progress={isCancelled || isScheduled ? undefined : {
                done: item.done,
                total: item.total,
                overdue: item.overdueCount,
              }}
              actions={isCancelled || isScheduled ? undefined : (
                <SentRequestCardActions
                  tenantCode={code}
                  requestId={item.id}
                  fromQuery="sent"
                  pendingCount={pendingCount}
                  overdueCount={item.overdueCount}
                />
              )}
            />
          );
        })}
      </div>

      {result.total > page * 20 && (
        <div className="text-center mt-4">
          <Link href={`/t/${code}/sent?filter=${filter}&page=${page + 1}`}
            className="text-primary text-sm hover:underline">
            もっと見る
          </Link>
        </div>
      )}
    </div>
  );
}
