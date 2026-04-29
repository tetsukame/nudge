import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { StatusBadge } from '@/ui/components/status-badge';
import { formatMinutes } from '@/lib/format-duration';

export const runtime = 'nodejs';

type AssignmentRow = {
  id: string;
  status: string;
  request_id: string;
  title: string;
  due_at: Date | null;
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

  // Hardcoded status sets — NOT user input, safe to interpolate
  const statusSql =
    statusFilter === 'done'
      ? `a.status IN ('responded','not_needed','forwarded','substituted','exempted','expired')`
      : `a.status IN ('unopened','opened')`;

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
           r.id AS request_id,
           r.title,
           r.due_at,
           (r.due_at IS NOT NULL AND r.due_at < now()
            AND a.status IN ('unopened','opened')) AS is_overdue,
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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">自分宛の依頼</h1>
        <Link
          href={`/t/${code}/requests/new`}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          ➕ 新規作成
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        <Link
          href={pendingHref}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            statusFilter === 'pending'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          未対応
        </Link>
        <Link
          href={doneHref}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            statusFilter === 'done'
              ? 'border-blue-600 text-blue-600'
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
        <p className="text-center text-gray-500 py-12">
          {statusFilter === 'pending' ? '未対応の依頼はありません。' : '完了済みの依頼はありません。'}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/t/${code}/requests/${item.request_id}`}
                className="block bg-white rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {item.has_unread && (
                        <span className="text-blue-500 text-sm leading-none" title="未読コメントあり">
                          🔵
                        </span>
                      )}
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {item.title}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {item.sender_name && (
                        <span>
                          依頼者: {item.sender_name}
                          {item.sender_org_unit_name && (
                            <span className="text-gray-400">（{item.sender_org_unit_name}）</span>
                          )}
                        </span>
                      )}
                      {item.due_at && (
                        <span className={item.is_overdue ? 'text-red-600 font-medium' : ''}>
                          期限: {formatDate(item.due_at)}
                          {item.is_overdue && ' ⚠️'}
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge
                    status={item.status}
                    overdue={item.is_overdue}
                    className="shrink-0 mt-0.5"
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          <Link
            href={`/t/${code}/requests?status=${statusFilter}&page=${page + 1}`}
            className="inline-block px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 transition-colors"
          >
            もっと見る
          </Link>
        </div>
      )}
    </div>
  );
}
