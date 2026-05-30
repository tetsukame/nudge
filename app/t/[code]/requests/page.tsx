import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { PageHeader } from '@/ui/components/page-header';
import { RequestCard } from '@/ui/components/request-card';
import { getStatusConfig } from '@/ui/status-config';
import { formatMinutes } from '@/lib/format-duration';

type AssigneeStatus =
  | 'unopened'
  | 'opened'
  | 'responded'
  | 'not_needed'
  | 'forwarded'
  | 'substituted'
  | 'exempted'
  | 'expired';

function statusVariantFor(
  status: string,
  isOverdue: boolean,
): 'pending' | 'done' | 'overdue' | 'opened' | 'unopened' {
  if (isOverdue && (status === 'unopened' || status === 'opened')) return 'overdue';
  if (status === 'unopened') return 'unopened';
  if (status === 'opened') return 'opened';
  return 'done';
}

export const runtime = 'nodejs';

type AssignmentRow = {
  id: string;
  status: string;
  request_status: string;
  request_id: string;
  title: string;
  due_at: Date | null;
  estimated_minutes: number | null;
  is_overdue: boolean;
  has_unread: boolean;
  sender_name: string | null;
  sender_org_unit_name: string | null;
};

const PAGE_SIZE = 20;

function formatDate(d: Date | null): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

export default async function RequestListPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { code } = await params;
  const sp = await searchParams;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const statusFilter = sp.status === 'done' ? 'done' : 'pending';
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Hardcoded status sets — NOT user input, safe to interpolate.
  // NDG-72: cancelled request は未対応タブから除外し、完了タブに含める
  // (受け取り側の "やるべきこと" には出さない / 履歴としては完了側で見える)
  const statusSql =
    statusFilter === 'done'
      ? `(a.status IN ('responded','not_needed','forwarded','substituted','exempted','expired') OR r.status = 'cancelled')`
      : `a.status IN ('unopened','opened') AND r.status <> 'cancelled'`;

  const { items, total, totalMinutes } = await withTenant(
    appPool(),
    session.tenantId,
    async (client) => {
      const { rows: countRows } = await client.query<{ n: string; sum_minutes: string | null }>(
        `SELECT COUNT(*)::text AS n,
                COALESCE(SUM(r.estimated_minutes), 0)::text AS sum_minutes
           FROM assignment a
           JOIN request r ON r.id = a.request_id
          WHERE a.user_id = $1 AND ${statusSql}`,
        [session.userId],
      );
      const total = parseInt(countRows[0].n, 10);
      const totalMinutes = parseInt(countRows[0].sum_minutes ?? '0', 10);

      const { rows } = await client.query<AssignmentRow>(
        `SELECT
           a.id,
           a.status,
           r.status AS request_status,
           r.id AS request_id,
           r.title,
           r.due_at,
           r.estimated_minutes,
           (r.due_at IS NOT NULL AND r.due_at < now()
            AND a.status IN ('unopened','opened')
            AND r.status <> 'cancelled') AS is_overdue,
           (
             SELECT COALESCE(MAX(rc.created_at) > a.last_viewed_at, a.last_viewed_at IS NULL)
               FROM request_comment rc
              WHERE rc.request_id = r.id
                AND (rc.assignment_id IS NULL OR rc.assignment_id = a.id)
           ) AS has_unread,
           u.display_name AS sender_name,
           ou.name AS sender_org_unit_name
         FROM assignment a
         JOIN request r ON r.id = a.request_id
         LEFT JOIN users u ON u.id = r.created_by_user_id
         LEFT JOIN org_unit ou ON ou.id = r.sender_org_unit_id
        WHERE a.user_id = $1 AND ${statusSql}
        ORDER BY r.due_at ASC NULLS LAST, a.created_at DESC
        LIMIT $2 OFFSET $3`,
        [session.userId, PAGE_SIZE, offset],
      );

      return { items: rows, total, totalMinutes };
    },
  );

  const hasMore = offset + PAGE_SIZE < total;
  const pendingHref = `/t/${code}/requests?status=pending`;
  const doneHref = `/t/${code}/requests?status=done`;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <PageHeader
        icon={<Inbox />}
        title="自分宛の依頼"
        description="あなたが対応する依頼の一覧です。期限が近い順に並びます。"
        action={
          <Link
            href={`/t/${code}/requests/new`}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors no-underline"
          >
            ＋ 新規作成
          </Link>
        }
        className="mb-6"
      />

      {/* Status tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <Link
          href={pendingHref}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            statusFilter === 'pending'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          未対応
        </Link>
        <Link
          href={doneHref}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            statusFilter === 'done'
              ? 'border-primary text-primary'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          完了
        </Link>
      </div>

      {/* Total time summary */}
      {total > 0 && (
        <div className="mb-3 text-sm text-gray-600">
          {statusFilter === 'pending' ? '⏱ 残り作業時間' : '✅ 完了済み合計'}:{' '}
          <span className="font-semibold text-gray-900">
            {formatMinutes(totalMinutes)}
          </span>
          <span className="ml-1 text-gray-500">（{total} 件）</span>
        </div>
      )}

      {/* Assignment cards */}
      {items.length === 0 ? (
        <div className="text-center py-12 px-4">
          <p className="text-base font-medium text-gray-700">
            {statusFilter === 'pending' ? '未対応の依頼はありません' : '完了済みの依頼はありません'}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            {statusFilter === 'pending'
              ? 'いま対応が必要な依頼はありません。新しい依頼が届くとここに表示されます。'
              : '完了した依頼はまだありません。対応が完了するとここに表示されます。'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const cfg = getStatusConfig(item.status);
            const senderText = item.sender_name
              ? item.sender_org_unit_name
                ? `依頼者：${item.sender_name}（${item.sender_org_unit_name}）`
                : `依頼者：${item.sender_name}`
              : undefined;
            const meta: { label: string; value: string }[] = [];
            if (item.estimated_minutes && item.estimated_minutes > 0) {
              meta.push({ label: '想定時間', value: formatMinutes(item.estimated_minutes) });
            }
            const isPending = item.status === 'unopened' || item.status === 'opened';
            // NDG-72: cancelled は履歴扱い。バッジは「🚫 取り消し済み」を優先表示
            const isCancelled = item.request_status === 'cancelled';
            const statusLabel = isCancelled ? '🚫 取り消し済み' : cfg.label;
            const statusVariant = isCancelled ? 'done' : statusVariantFor(item.status, item.is_overdue);
            return (
              <li key={item.id}>
                <RequestCard
                  href={`/t/${code}/requests/${item.request_id}`}
                  title={item.title}
                  subtitle={senderText}
                  dueLabel={item.due_at ? `期限：${formatDate(item.due_at)}` : undefined}
                  dueOverdue={item.is_overdue}
                  statusLabel={statusLabel}
                  statusVariant={statusVariant}
                  meta={meta.length > 0 ? meta : undefined}
                  unread={item.has_unread}
                  actionLabel={isPending && !isCancelled ? '対応する' : undefined}
                />
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/t/${code}/requests?status=${statusFilter}&page=${page + 1}`}
            className="inline-block px-4 py-2 text-sm text-primary border border-primary/30 rounded-md hover:bg-primary/5 transition-colors"
          >
            もっと見る
          </Link>
        </div>
      )}
    </div>
  );
}
