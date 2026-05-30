import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type SentFilter = 'all' | 'in_progress' | 'done' | 'scheduled';

export type ListSentRequestsInput = {
  filter?: SentFilter;
  q?: string;
  page?: number;
  pageSize?: number;
  /**
   * tenant 全体の依頼一覧として扱う場合 true（tenant_admin 専用）。
   * default = false: actor が作成した依頼のみ。
   */
  tenantWide?: boolean;
  /**
   * NDG-41: 依頼者 (created_by) が退職 (users.status='inactive') の依頼のみに絞る。
   * tenantWide のときだけ意味を持つ。
   */
  retiredRequesterOnly?: boolean;
};

export type SentRequestItem = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdByStatus: 'active' | 'inactive' | null;
  total: number;
  unopened: number;
  opened: number;
  responded: number;
  notNeeded: number;
  other: number;
  done: number;
  overdueCount: number;
};

export type ListSentRequestsResult = {
  items: SentRequestItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type SentFilterCounts = {
  all: number;
  inProgress: number;
  done: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const DONE_STATUSES = `'responded','not_needed','forwarded','substituted','exempted','expired'`;

export async function listSentRequests(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListSentRequestsInput,
): Promise<ListSentRequestsResult> {
  const safePage = Number.isFinite(input.page) ? (input.page as number) : 1;
  const safePageSize = Number.isFinite(input.pageSize) ? (input.pageSize as number) : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, safePage);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, safePageSize));
  const offset = (page - 1) * pageSize;
  const filter = input.filter ?? 'all';

  const tenantWide = input.tenantWide ?? false;
  if (tenantWide && !actor.isTenantAdmin) {
    throw new Error('tenantWide listing requires tenant_admin');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    const params: unknown[] = [];
    let creatorClause: string;
    if (tenantWide) {
      creatorClause = '';
    } else {
      params.push(actor.userId);
      creatorClause = `WHERE r.created_by_user_id = $${params.length}`;
    }

    let qClause = '';
    if (input.q && input.q.trim()) {
      params.push(`%${input.q.trim()}%`);
      qClause = `${creatorClause === '' ? 'WHERE' : 'AND'} r.title ILIKE $${params.length}`;
    }

    let retiredClause = '';
    if (tenantWide && input.retiredRequesterOnly) {
      const kw = creatorClause === '' && qClause === '' ? 'WHERE' : 'AND';
      retiredClause = `${kw} cu.status = 'inactive'`;
    }

    // NDG-70: scheduled (draft + scheduled_at) は別系統。他フィルタとは排他。
    let scheduledClause = '';
    if (filter === 'scheduled') {
      const kw = creatorClause === '' && qClause === '' && retiredClause === ''
        ? 'WHERE' : 'AND';
      scheduledClause = `${kw} r.status = 'draft' AND r.scheduled_at IS NOT NULL`;
    } else {
      // それ以外のタブ (all/in_progress/done) では draft は除外する
      const kw = creatorClause === '' && qClause === '' && retiredClause === ''
        ? 'WHERE' : 'AND';
      scheduledClause = `${kw} r.status <> 'draft'`;
    }

    let havingClause = '';
    if (filter === 'in_progress') {
      havingClause = `HAVING COUNT(*) FILTER (WHERE a.status IN ('unopened','opened')) > 0`;
    } else if (filter === 'done') {
      havingClause = `HAVING COUNT(*) FILTER (WHERE a.status NOT IN (${DONE_STATUSES})) = 0
                        AND COUNT(*) > 0`;
    }

    const baseSql = `
      FROM request r
      LEFT JOIN assignment a ON a.request_id = r.id
      LEFT JOIN users cu ON cu.id = r.created_by_user_id
      ${creatorClause}
      ${qClause}
      ${retiredClause}
      ${scheduledClause}
      GROUP BY r.id, r.title, r.status, r.due_at, r.scheduled_at, r.created_at,
               r.created_by_user_id, cu.display_name, cu.status
      ${havingClause}
    `;

    const countSql = `SELECT COUNT(*)::int AS n FROM (
      SELECT r.id
      ${baseSql}
    ) sub`;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    params.push(pageSize, offset);
    const pLimit = `$${params.length - 1}`;
    const pOffset = `$${params.length}`;

    const itemSql = `
      SELECT
        r.id,
        r.title,
        r.status,
        r.due_at,
        r.scheduled_at,
        r.created_at,
        r.created_by_user_id,
        cu.display_name AS created_by_name,
        cu.status AS created_by_status,
        COUNT(a.id)::int AS total,
        COUNT(*) FILTER (WHERE a.status = 'unopened')::int AS unopened,
        COUNT(*) FILTER (WHERE a.status = 'opened')::int AS opened,
        COUNT(*) FILTER (WHERE a.status = 'responded')::int AS responded,
        COUNT(*) FILTER (WHERE a.status = 'not_needed')::int AS not_needed,
        COUNT(*) FILTER (WHERE a.status NOT IN ('unopened','opened','responded','not_needed') AND a.status NOT IN (${DONE_STATUSES}))::int AS other,
        COUNT(*) FILTER (WHERE a.status IN (${DONE_STATUSES}))::int AS done,
        COUNT(*) FILTER (
          WHERE a.status IN ('unopened','opened')
            AND r.due_at IS NOT NULL
            AND r.due_at < now()
        )::int AS overdue_count
      ${baseSql}
      ORDER BY ${filter === 'scheduled' ? 'r.scheduled_at ASC' : 'r.due_at ASC NULLS LAST, (COUNT(a.id) - COUNT(*) FILTER (WHERE a.status IN (' + DONE_STATUSES + '))) DESC'}
      LIMIT ${pLimit} OFFSET ${pOffset}
    `;

    const { rows } = await client.query(itemSql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        createdByUserId: r.created_by_user_id ?? null,
        createdByName: r.created_by_name ?? null,
        createdByStatus: r.created_by_status ?? null,
        total: r.total,
        unopened: r.unopened,
        opened: r.opened,
        responded: r.responded,
        notNeeded: r.not_needed,
        other: r.other,
        done: r.done,
        overdueCount: r.overdue_count,
      })),
      total,
      page,
      pageSize,
    };
  });
}

/**
 * NDG-80: タブごとの件数を 1 クエリでまとめて取得する。
 *
 * `listSentRequests` 側の filter 別 HAVING と完全に整合させるため、
 * リクエスト単位に集約した CTE の上で FILTER (...) を被せている。
 * filter/page/pageSize は無関係（カウント専用）。q / retiredRequesterOnly /
 * tenantWide は listSentRequests と同じく作用する。
 */
export async function countSentRequestsByFilter(
  pool: pg.Pool,
  actor: ActorContext,
  input: Pick<ListSentRequestsInput, 'q' | 'retiredRequesterOnly' | 'tenantWide'>,
): Promise<SentFilterCounts> {
  const tenantWide = input.tenantWide ?? false;
  if (tenantWide && !actor.isTenantAdmin) {
    throw new Error('tenantWide listing requires tenant_admin');
  }
  return withTenant(pool, actor.tenantId, async (client) => {
    const params: unknown[] = [];
    let creatorClause: string;
    if (tenantWide) {
      creatorClause = '';
    } else {
      params.push(actor.userId);
      creatorClause = `WHERE r.created_by_user_id = $${params.length}`;
    }
    let qClause = '';
    if (input.q && input.q.trim()) {
      params.push(`%${input.q.trim()}%`);
      qClause = `${creatorClause === '' ? 'WHERE' : 'AND'} r.title ILIKE $${params.length}`;
    }
    let retiredClause = '';
    if (tenantWide && input.retiredRequesterOnly) {
      const kw = creatorClause === '' && qClause === '' ? 'WHERE' : 'AND';
      retiredClause = `${kw} cu.status = 'inactive'`;
    }

    const sql = `
      WITH req AS (
        SELECT
          r.id,
          COUNT(*) FILTER (WHERE a.status IN ('unopened','opened'))::int AS pending,
          COUNT(a.id)::int AS total_asg,
          COUNT(*) FILTER (WHERE a.status IN (${DONE_STATUSES}))::int AS done_asg
        FROM request r
        LEFT JOIN assignment a ON a.request_id = r.id
        LEFT JOIN users cu ON cu.id = r.created_by_user_id
        ${creatorClause}
        ${qClause}
        ${retiredClause}
        GROUP BY r.id
      )
      SELECT
        COUNT(*)::int AS all_count,
        COUNT(*) FILTER (WHERE pending > 0)::int AS in_progress_count,
        COUNT(*) FILTER (WHERE total_asg > 0 AND done_asg = total_asg)::int AS done_count
      FROM req
    `;
    const { rows } = await client.query<{
      all_count: number;
      in_progress_count: number;
      done_count: number;
    }>(sql, params);
    const r = rows[0];
    return { all: r.all_count, inProgress: r.in_progress_count, done: r.done_count };
  });
}
