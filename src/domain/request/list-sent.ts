import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type SentFilter = 'all' | 'in_progress' | 'done';

export type ListSentRequestsInput = {
  filter?: SentFilter;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type SentRequestItem = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
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

  return withTenant(pool, actor.tenantId, async (client) => {
    const params: unknown[] = [actor.userId];

    let qClause = '';
    if (input.q && input.q.trim()) {
      params.push(`%${input.q.trim()}%`);
      qClause = `AND r.title ILIKE $${params.length}`;
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
      WHERE r.created_by_user_id = $1
        ${qClause}
      GROUP BY r.id, r.title, r.status, r.due_at, r.created_at
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
        r.created_at,
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
      ORDER BY r.due_at ASC NULLS LAST, (COUNT(a.id) - COUNT(*) FILTER (WHERE a.status IN (${DONE_STATUSES}))) DESC
      LIMIT ${pLimit} OFFSET ${pOffset}
    `;

    const { rows } = await client.query(itemSql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
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
