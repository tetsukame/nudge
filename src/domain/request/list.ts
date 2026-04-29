import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type ListScope = 'mine' | 'subordinate' | 'all';

export type ListRequestsInput = {
  scope: ListScope;
  page?: number;
  pageSize?: number;
};

export type RequestListItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  createdByUserId: string;
  estimatedMinutes: number;
  senderOrgUnitId: string | null;
  senderOrgUnitName: string | null;
};

export type ListRequestsResult = {
  items: RequestListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export class ListRequestsError extends Error {
  constructor(msg: string, readonly code: 'permission_denied' | 'validation') {
    super(msg);
    this.name = 'ListRequestsError';
  }
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function listRequests(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListRequestsInput,
): Promise<ListRequestsResult> {
  const safePage = Number.isFinite(input.page) ? (input.page as number) : 1;
  const safePageSize = Number.isFinite(input.pageSize) ? (input.pageSize as number) : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, safePage);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, safePageSize));
  const offset = (page - 1) * pageSize;

  if (input.scope === 'all' && !(actor.isTenantWideRequester || actor.isTenantAdmin)) {
    throw new ListRequestsError('scope=all requires tenant-wide permission', 'permission_denied');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    let where = '';
    const params: unknown[] = [];

    if (input.scope === 'mine') {
      params.push(actor.userId);
      where = `WHERE (r.created_by_user_id = $1
                  OR EXISTS (SELECT 1 FROM assignment a
                              WHERE a.request_id = r.id AND a.user_id = $1))`;
    } else if (input.scope === 'subordinate') {
      params.push(actor.userId);
      where = `WHERE EXISTS (
                 SELECT 1
                   FROM assignment a
                   JOIN user_org_unit uou ON uou.user_id = a.user_id
                   JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
                   JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
                  WHERE a.request_id = r.id AND m.user_id = $1
               )`;
    }
    // scope=all: no WHERE; RLS enforces tenant isolation

    const countSql = `SELECT COUNT(*)::int AS n FROM request r ${where}`;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    params.push(pageSize, offset);
    const itemSql = `
      SELECT r.id, r.title, r.type, r.status,
             r.due_at, r.created_at, r.created_by_user_id, r.estimated_minutes,
             r.sender_org_unit_id, ou.name AS sender_org_unit_name
        FROM request r
        LEFT JOIN org_unit ou ON ou.id = r.sender_org_unit_id
        ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await client.query(itemSql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        status: r.status,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        createdByUserId: r.created_by_user_id,
        estimatedMinutes: r.estimated_minutes,
        senderOrgUnitId: r.sender_org_unit_id ?? null,
        senderOrgUnitName: r.sender_org_unit_name ?? null,
      })),
      total,
      page,
      pageSize,
    };
  });
}
