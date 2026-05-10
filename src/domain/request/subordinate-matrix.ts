import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext, AssignmentStatus } from '../types';

export type SubordinateMatrixFilter = 'all' | 'in_progress' | 'done';

export type ListSubordinateMatrixInput = {
  filter?: SubordinateMatrixFilter;
  q?: string;
  orgUnitId?: string;
  overdueOnly?: boolean;
  dueWithinDays?: number;
};

export type SubordinateMatrixUser = {
  userId: string;
  displayName: string;
  orgUnitName: string | null;
  pendingCount: number;
  overdueCount: number;
};

export type SubordinateMatrixRequest = {
  requestId: string;
  title: string;
  dueAt: string | null;
  pendingCount: number;
  overdueCount: number;
  /** マネージャの subtree 内での合計 assignment 数（status / date フィルタは無視）。 */
  subtreeTotal: number;
  /** subtree 内で完了状態 (responded 等) になっている数。完了パーセントの分子。 */
  subtreeDone: number;
};

export type SubordinateMatrixCell = {
  userId: string;
  requestId: string;
  assignmentId: string;
  status: AssignmentStatus;
  isOverdue: boolean;
  hasUnread: boolean;
};

export type ListSubordinateMatrixResult = {
  users: SubordinateMatrixUser[];
  requests: SubordinateMatrixRequest[];
  cells: SubordinateMatrixCell[];
};

const PENDING_STATUSES = ['unopened', 'opened'];
const DONE_STATUSES = [
  'responded', 'not_needed', 'forwarded', 'substituted', 'exempted', 'expired',
];

/**
 * 配下のマネージャ視点で `(subordinate user × request)` のマトリクスを返す。
 * - filter='in_progress' (既定): 配下のうち pending な assignment のみ
 * - filter='done': 配下のうち完了した assignment のみ
 * - filter='all': 上記両方
 *
 * users / requests は集計済み。cells はスパースに該当 assignment のみ。
 */
export async function listSubordinateMatrix(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListSubordinateMatrixInput,
): Promise<ListSubordinateMatrixResult> {
  const filter = input.filter ?? 'in_progress';

  return withTenant(pool, actor.tenantId, async (client) => {
    const params: unknown[] = [actor.userId];

    let qClause = '';
    if (input.q && input.q.trim()) {
      params.push(`%${input.q.trim()}%`);
      qClause = `AND r.title ILIKE $${params.length}`;
    }

    let orgClause = '';
    if (input.orgUnitId) {
      params.push(input.orgUnitId);
      orgClause = `AND uou.org_unit_id = $${params.length}::uuid`;
    }

    let statusClause: string;
    if (filter === 'in_progress') {
      statusClause = `a.status = ANY($${params.length + 1}::text[])`;
      params.push(PENDING_STATUSES);
    } else if (filter === 'done') {
      statusClause = `a.status = ANY($${params.length + 1}::text[])`;
      params.push(DONE_STATUSES);
    } else {
      statusClause = `a.status = ANY($${params.length + 1}::text[])`;
      params.push([...PENDING_STATUSES, ...DONE_STATUSES]);
    }

    // Date filters can be combined with OR when both flags are set.
    const dateConditions: string[] = [];
    if (input.overdueOnly) {
      dateConditions.push(
        `(r.due_at IS NOT NULL AND r.due_at < now() AND a.status = ANY(ARRAY['unopened','opened']))`,
      );
    }
    if (typeof input.dueWithinDays === 'number' && input.dueWithinDays > 0) {
      params.push(input.dueWithinDays);
      dateConditions.push(
        `(r.due_at IS NOT NULL AND r.due_at >= now()
          AND r.due_at <= now() + ($${params.length}::int || ' days')::interval)`,
      );
    }
    const dateClause = dateConditions.length > 0
      ? `AND (${dateConditions.join(' OR ')})`
      : '';

    const cteSql = `
      WITH my_subtree_users AS (
        SELECT DISTINCT uou.user_id
          FROM org_unit_manager m
          JOIN org_unit_closure c ON c.ancestor_id = m.org_unit_id
          JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
                                AND uou.user_id != $1
         WHERE m.user_id = $1
      ),
      filtered_assignments AS (
        SELECT a.id AS assignment_id, a.status, a.user_id, a.last_viewed_at,
               r.id AS request_id, r.title, r.due_at, r.created_by_user_id,
               (a.status IN ('unopened','opened')
                AND r.due_at IS NOT NULL AND r.due_at < now()) AS is_overdue
          FROM assignment a
          JOIN request r ON r.id = a.request_id
          JOIN my_subtree_users mu ON mu.user_id = a.user_id
          JOIN user_org_unit uou ON uou.user_id = a.user_id AND uou.is_primary = true
         WHERE ${statusClause}
           ${qClause}
           ${orgClause}
           ${dateClause}
      )
    `;

    const cellSql = `${cteSql}
      SELECT
        fa.user_id,
        fa.request_id,
        fa.assignment_id,
        fa.status,
        fa.is_overdue,
        EXISTS (
          SELECT 1 FROM request_comment rc
           WHERE rc.assignment_id = fa.assignment_id
             AND rc.author_user_id != fa.created_by_user_id
             AND (fa.last_viewed_at IS NULL OR rc.created_at > fa.last_viewed_at)
        ) AS has_unread
      FROM filtered_assignments fa
    `;
    const { rows: cellRows } = await client.query(cellSql, params);

    const cells: SubordinateMatrixCell[] = cellRows.map((r) => ({
      userId: r.user_id,
      requestId: r.request_id,
      assignmentId: r.assignment_id,
      status: r.status as AssignmentStatus,
      isOverdue: r.is_overdue,
      hasUnread: r.has_unread,
    }));

    if (cells.length === 0) {
      return { users: [], requests: [], cells: [] };
    }

    const userIds = Array.from(new Set(cells.map((c) => c.userId)));
    const requestIds = Array.from(new Set(cells.map((c) => c.requestId)));

    // Per-request subtree totals (ignores status / date filters but respects q / orgUnit filters).
    // Used for the 完了パーセント shown on the task-mode group header.
    const subtreeTotalParams: unknown[] = [actor.userId, requestIds];
    let subtreeOrgClause = '';
    if (input.orgUnitId) {
      subtreeTotalParams.push(input.orgUnitId);
      subtreeOrgClause = `AND uou.org_unit_id = $${subtreeTotalParams.length}::uuid`;
    }
    const { rows: totalsRows } = await client.query<{
      request_id: string;
      subtree_total: number;
      subtree_done: number;
    }>(
      `WITH my_subtree_users AS (
         SELECT DISTINCT uou.user_id
           FROM org_unit_manager m
           JOIN org_unit_closure c ON c.ancestor_id = m.org_unit_id
           JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
                                 AND uou.user_id != $1
          WHERE m.user_id = $1
       )
       SELECT a.request_id,
              COUNT(*)::int AS subtree_total,
              COUNT(*) FILTER (WHERE a.status = ANY(ARRAY[${DONE_STATUSES.map((s) => `'${s}'`).join(',')}]))::int AS subtree_done
         FROM assignment a
         JOIN my_subtree_users mu ON mu.user_id = a.user_id
         JOIN user_org_unit uou ON uou.user_id = a.user_id AND uou.is_primary = true
        WHERE a.request_id = ANY($2::uuid[])
          ${subtreeOrgClause}
        GROUP BY a.request_id`,
      subtreeTotalParams,
    );
    const totalsMap = new Map(
      totalsRows.map((r) => [
        r.request_id,
        { total: r.subtree_total, done: r.subtree_done },
      ]),
    );

    const { rows: userRows } = await client.query<{
      user_id: string;
      display_name: string;
      org_unit_name: string | null;
    }>(
      `SELECT u.id AS user_id, u.display_name,
              ou.name AS org_unit_name
         FROM users u
         LEFT JOIN user_org_unit prim ON prim.user_id = u.id AND prim.is_primary = true
         LEFT JOIN org_unit ou ON ou.id = prim.org_unit_id
        WHERE u.id = ANY($1::uuid[])`,
      [userIds],
    );

    const { rows: reqRows } = await client.query<{
      request_id: string;
      title: string;
      due_at: Date | null;
    }>(
      `SELECT id AS request_id, title, due_at
         FROM request
        WHERE id = ANY($1::uuid[])`,
      [requestIds],
    );

    const userMap = new Map(userRows.map((r) => [r.user_id, r]));
    const reqMap = new Map(reqRows.map((r) => [r.request_id, r]));

    const userPending = new Map<string, number>();
    const userOverdue = new Map<string, number>();
    const reqPending = new Map<string, number>();
    const reqOverdue = new Map<string, number>();

    for (const c of cells) {
      const isPending = PENDING_STATUSES.includes(c.status);
      if (isPending) {
        userPending.set(c.userId, (userPending.get(c.userId) ?? 0) + 1);
        reqPending.set(c.requestId, (reqPending.get(c.requestId) ?? 0) + 1);
      }
      if (c.isOverdue) {
        userOverdue.set(c.userId, (userOverdue.get(c.userId) ?? 0) + 1);
        reqOverdue.set(c.requestId, (reqOverdue.get(c.requestId) ?? 0) + 1);
      }
    }

    const users: SubordinateMatrixUser[] = userIds
      .map((id) => {
        const u = userMap.get(id);
        return {
          userId: id,
          displayName: u?.display_name ?? '—',
          orgUnitName: u?.org_unit_name ?? null,
          pendingCount: userPending.get(id) ?? 0,
          overdueCount: userOverdue.get(id) ?? 0,
        };
      })
      .sort((a, b) =>
        b.pendingCount - a.pendingCount
        || b.overdueCount - a.overdueCount
        || a.displayName.localeCompare(b.displayName, 'ja'),
      );

    const requests: SubordinateMatrixRequest[] = requestIds
      .map((id) => {
        const r = reqMap.get(id);
        const totals = totalsMap.get(id);
        return {
          requestId: id,
          title: r?.title ?? '—',
          dueAt: r?.due_at ? new Date(r.due_at).toISOString() : null,
          pendingCount: reqPending.get(id) ?? 0,
          overdueCount: reqOverdue.get(id) ?? 0,
          subtreeTotal: totals?.total ?? 0,
          subtreeDone: totals?.done ?? 0,
        };
      })
      .sort((a, b) => {
        // due_at ASC NULLS LAST
        if (a.dueAt && b.dueAt) {
          if (a.dueAt < b.dueAt) return -1;
          if (a.dueAt > b.dueAt) return 1;
        } else if (a.dueAt && !b.dueAt) {
          return -1;
        } else if (!a.dueAt && b.dueAt) {
          return 1;
        }
        return b.overdueCount - a.overdueCount;
      });

    return { users, requests, cells };
  });
}
