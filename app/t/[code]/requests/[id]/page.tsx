import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { openAssignment } from '@/domain/assignment/actions';
import { markViewed } from '@/domain/assignment/view';
import { StatusBadge } from '@/ui/components/status-badge';
import { ActionButtons } from '@/ui/components/action-buttons';
import { CommentSection } from '@/ui/components/comment-thread';

export const runtime = 'nodejs';

function formatDate(d: Date | null | string): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d as string);
  return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
}

function isOverdue(dueAt: Date | null | string, status: string): boolean {
  if (!dueAt) return false;
  if (status !== 'unopened' && status !== 'opened') return false;
  return new Date(dueAt as string) < new Date();
}

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string }>;
}) {
  const { code, id } = await params;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const pool = appPool();

  // Fetch request + my assignment from DB
  const data = await withTenant(pool, session.tenantId, async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT r.id, r.title, r.body, r.type, r.status, r.due_at, r.created_at,
              r.created_by_user_id,
              u.display_name AS sender_name
         FROM request r
         LEFT JOIN users u ON u.id = r.created_by_user_id
        WHERE r.id = $1`,
      [id],
    );
    if (reqRows.length === 0) return null;
    const req = reqRows[0];

    const { rows: asgRows } = await client.query(
      `SELECT a.id, a.status,
              (r.due_at IS NOT NULL AND r.due_at < now()
               AND a.status IN ('unopened','opened')) AS is_overdue
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.request_id = $1 AND a.user_id = $2
        LIMIT 1`,
      [id, session.userId],
    );
    const myAssignment = asgRows.length > 0 ? asgRows[0] : null;

    return { req, myAssignment };
  });

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <p className="text-gray-500">依頼が見つかりません。</p>
        <Link href={`/t/${code}/requests`} className="text-blue-600 hover:underline text-sm">
          ← 一覧に戻る
        </Link>
      </div>
    );
  }

  const { req, myAssignment } = data;
  const isRequester = req.created_by_user_id === session.userId;
  const overdue = isOverdue(req.due_at, myAssignment?.status ?? req.status);

  // Auto-open and mark-viewed: fire-and-forget
  if (myAssignment?.status === 'unopened') {
    const actor = {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: false,
      isTenantWideRequester: false,
    };
    void openAssignment(pool, actor, myAssignment.id).catch(() => {});
  }
  if (myAssignment?.id) {
    const actor = {
      userId: session.userId,
      tenantId: session.tenantId,
      isTenantAdmin: false,
      isTenantWideRequester: false,
    };
    void markViewed(pool, actor, myAssignment.id).catch(() => {});
  }

  const typeLabelMap: Record<string, string> = {
    task: 'タスク',
    survey: 'アンケート',
  };
  const typeLabel = typeLabelMap[req.type as string] ?? req.type;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Back link */}
      <Link
        href={`/t/${code}/requests`}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← 一覧に戻る
      </Link>

      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-bold text-gray-900 flex-1">{req.title}</h1>
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            {typeLabel}
          </span>
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-gray-600">
          {req.sender_name && (
            <div>
              <span className="font-medium">依頼者:</span> {req.sender_name}
            </div>
          )}
          {req.due_at && (
            <div className={overdue ? 'text-red-600 font-medium' : ''}>
              <span className="font-medium">期限:</span>{' '}
              {formatDate(req.due_at)}
              {overdue && ' ⚠️ 期限超過'}
            </div>
          )}
          {req.created_at && (
            <div>
              <span className="font-medium">依頼日:</span>{' '}
              {formatDate(req.created_at)}
            </div>
          )}
        </div>

        {myAssignment && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">ステータス:</span>
            <StatusBadge status={myAssignment.status} overdue={myAssignment.is_overdue} />
          </div>
        )}

        {req.body && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{req.body}</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {myAssignment && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-medium text-gray-700 mb-3">アクション</h2>
          <ActionButtons
            tenantCode={code}
            assignmentId={myAssignment.id}
            requestId={id}
            status={myAssignment.status}
          />
        </div>
      )}

      {/* Comment section */}
      <CommentSection
        tenantCode={code}
        requestId={id}
        assignmentId={myAssignment?.id ?? null}
        isRequester={isRequester}
        currentUserId={session.userId}
      />
    </div>
  );
}
