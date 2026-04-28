import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type SubordinateFilter = 'all' | 'in_progress' | 'done';

export type ListSubordinateRequestsInput = {
  filter?: SubordinateFilter;
  q?: string;
  orgUnitId?: string;
  page?: number;
  pageSize?: number;
};

export type SubordinateRequestItem = {
  id: string;
  title: string;
  type: string;
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

export type ListSubordinateRequestsResult = {
  items: SubordinateRequestItem[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const DONE_STATUSES = `'responded','not_needed','forwarded','substituted','exempted','expired'`;

export async function listSubordinateRequests(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListSubordinateRequestsInput,
): Promise<ListSubordinateRequestsResult> {
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

    let orgUnitClause = '';
    if (input.orgUnitId) {
      params.push(input.orgUnitId);
      orgUnitClause = `AND EXISTS (
        SELECT 1
          FROM assignment ax
          JOIN user_org_unit ax_org ON ax_org.user_id = ax.user_id
          JOIN org_unit_closure ax_c ON ax_c.descendant_id = ax_org.org_unit_id
          JOIN org_unit_manager ax_m ON ax_m.org_unit_id = ax_c.ancestor_id
         WHERE ax.request_id = r.id
           AND ax_m.user_id = $1
           AND ax_org.org_unit_id = $${params.length}::uuid
      )`;
    }

    let havingClause = '';
    if (filter === 'in_progress') {
      havingClause = `HAVING COUNT(*) FILTER (WHERE a.status IN ('unopened','opened') AND a.user_id IN (SELECT user_id FROM my_subtree_users)) > 0`;
    } else if (filter === 'done') {
      havingClause = `HAVING COUNT(*) FILTER (WHERE a.status NOT IN (${DONE_STATUSES}) AND a.user_id IN (SELECT user_id FROM my_subtree_users)) = 0
                        AND COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)) > 0`;
    }

    const cteSql = `
      WITH my_subtree_users AS (
        SELECT uou.user_id
          FROM org_unit_manager m
          JOIN org_unit_closure c ON c.ancestor_id = m.org_unit_id
          JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
         WHERE m.user_id = $1
      )
    `;

    const baseSql = `
      FROM request r
      LEFT JOIN assignment a ON a.request_id = r.id
      WHERE EXISTS (
        SELECT 1
          FROM assignment ax2
         WHERE ax2.request_id = r.id
           AND ax2.user_id IN (SELECT user_id FROM my_subtree_users)
      )
      ${qClause}
      ${orgUnitClause}
      GROUP BY r.id, r.title, r.type, r.status, r.due_at, r.created_at
      ${havingClause}
    `;

    const countSql = `${cteSql}
      SELECT COUNT(*)::int AS n FROM (
        SELECT r.id
        ${baseSql}
      ) sub`;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    params.push(pageSize, offset);
    const pLimit = `$${params.length - 1}`;
    const pOffset = `$${params.length}`;

    const itemSql = `${cteSql}
      SELECT
        r.id,
        r.title,
        r.type,
        r.status,
        r.due_at,
        r.created_at,
        COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS total,
        COUNT(*) FILTER (WHERE a.status = 'unopened' AND a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS unopened,
        COUNT(*) FILTER (WHERE a.status = 'opened' AND a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS opened,
        COUNT(*) FILTER (WHERE a.status = 'responded' AND a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS responded,
        COUNT(*) FILTER (WHERE a.status = 'not_needed' AND a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS not_needed,
        COUNT(*) FILTER (WHERE a.status NOT IN ('unopened','opened','responded','not_needed') AND a.status NOT IN (${DONE_STATUSES}) AND a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS other,
        COUNT(*) FILTER (WHERE a.status IN (${DONE_STATUSES}) AND a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS done,
        COUNT(*) FILTER (
          WHERE a.status IN ('unopened','opened')
            AND a.user_id IN (SELECT user_id FROM my_subtree_users)
            AND r.due_at IS NOT NULL
            AND r.due_at < now()
        )::int AS overdue_count
      ${baseSql}
      ORDER BY r.due_at ASC NULLS LAST,
               (COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users))
                - COUNT(*) FILTER (WHERE a.status IN (${DONE_STATUSES}) AND a.user_id IN (SELECT user_id FROM my_subtree_users))) DESC
      LIMIT ${pLimit} OFFSET ${pOffset}
    `;

    const { rows } = await client.query(itemSql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
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
