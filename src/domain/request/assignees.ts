import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext, AssignmentStatus } from '../types';

export class AssigneesError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found',
  ) {
    super(message);
    this.name = 'AssigneesError';
  }
}

export type ListAssigneesInput = {
  q?: string;
  orgUnitId?: string;
  includeDescendants?: boolean;
  groupId?: string;
  statuses?: AssignmentStatus[];
  hasUnread?: boolean;
  page?: number;
  pageSize?: number;
};

export type AssigneeItem = {
  assignmentId: string;
  userId: string;
  displayName: string;
  email: string;
  orgUnitName: string | null;
  status: AssignmentStatus;
  isOverdue: boolean;
  openedAt: string | null;
  respondedAt: string | null;
  actionAt: string | null;
  forwardedToName: string | null;
  commentCount: number;
  hasUnread: boolean;
};

export type AssigneeSummary = {
  total: number;
  unopened: number;
  opened: number;
  responded: number;
  notNeeded: number;
  forwarded: number;
  substituted: number;
  exempted: number;
  expired: number;
  other: number;
  overdue: number;
};

export type ListAssigneesResult = {
  items: AssigneeItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: AssigneeSummary;
};

type AccessLevel = 'requester' | 'manager';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

async function checkAccess(
  client: pg.PoolClient,
  actor: ActorContext,
  requestId: string,
): Promise<AccessLevel> {
  // Check if requester
  if (actor.isTenantAdmin || actor.isTenantWideRequester) {
    return 'requester';
  }

  const { rows: reqRows } = await client.query<{ created_by_user_id: string }>(
    `SELECT created_by_user_id FROM request WHERE id = $1`,
    [requestId],
  );
  if (reqRows.length === 0) {
    throw new AssigneesError('request not found', 'not_found');
  }

  if (reqRows[0].created_by_user_id === actor.userId) {
    return 'requester';
  }

  // Check if manager of any assignee
  const { rows: mgrRows } = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM assignment a
       JOIN user_org_unit uou ON uou.user_id = a.user_id
       JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
       JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
      WHERE a.request_id = $1 AND m.user_id = $2`,
    [requestId, actor.userId],
  );
  if (mgrRows[0].n > 0) {
    return 'manager';
  }

  throw new AssigneesError('access denied', 'permission_denied');
}

export async function listAssignees(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
  input: ListAssigneesInput,
): Promise<ListAssigneesResult> {
  const safePage = Number.isFinite(input.page) ? (input.page as number) : 1;
  const safePageSize = Number.isFinite(input.pageSize) ? (input.pageSize as number) : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, safePage);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, safePageSize));
  const offset = (page - 1) * pageSize;

  return withTenant(pool, actor.tenantId, async (client) => {
    const access = await checkAccess(client, actor, requestId);

    const params: unknown[] = [requestId];

    // Manager-only: restrict to subordinates
    let scopeClause = '';
    if (access === 'manager') {
      params.push(actor.userId);
      scopeClause = `AND a.user_id IN (
        SELECT uou.user_id
          FROM org_unit_manager m2
          JOIN org_unit_closure c2 ON c2.ancestor_id = m2.org_unit_id
          JOIN user_org_unit uou ON uou.org_unit_id = c2.descendant_id
         WHERE m2.user_id = $${params.length}
      )`;
    }

    // q filter
    let qClause = '';
    if (input.q && input.q.trim()) {
      params.push(`%${input.q.trim()}%`);
      qClause = `AND (u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    // orgUnitId filter
    let orgUnitClause = '';
    if (input.orgUnitId) {
      params.push(input.orgUnitId);
      if (input.includeDescendants) {
        orgUnitClause = `AND EXISTS (
          SELECT 1
            FROM user_org_unit uou2
            JOIN org_unit_closure oc ON oc.descendant_id = uou2.org_unit_id
           WHERE uou2.user_id = a.user_id
             AND oc.ancestor_id = $${params.length}::uuid
        )`;
      } else {
        orgUnitClause = `AND EXISTS (
          SELECT 1 FROM user_org_unit uou2
           WHERE uou2.user_id = a.user_id
             AND uou2.org_unit_id = $${params.length}::uuid
        )`;
      }
    }

    // groupId filter
    let groupClause = '';
    if (input.groupId) {
      params.push(input.groupId);
      groupClause = `AND EXISTS (
        SELECT 1 FROM group_member gm
         WHERE gm.user_id = a.user_id
           AND gm.group_id = $${params.length}::uuid
      )`;
    }

    // statuses filter
    let statusClause = '';
    if (input.statuses && input.statuses.length > 0) {
      params.push(input.statuses);
      statusClause = `AND a.status = ANY($${params.length}::text[])`;
    }

    // hasUnread filter (comments from non-requester after last_viewed_by_requester_at or that column IS NULL)
    let unreadClause = '';
    if (input.hasUnread === true) {
      unreadClause = `AND EXISTS (
        SELECT 1 FROM request_comment rc
         WHERE rc.assignment_id = a.id
           AND rc.author_user_id != r.created_by_user_id
           AND (r.last_viewed_by_requester_at IS NULL
                OR rc.created_at > r.last_viewed_by_requester_at)
      )`;
    }

    const whereSql = `
      WHERE a.request_id = $1
        ${scopeClause}
        ${qClause}
        ${orgUnitClause}
        ${groupClause}
        ${statusClause}
        ${unreadClause}
    `;

    // Count
    const countSql = `
      SELECT COUNT(*)::int AS n
        FROM assignment a
        JOIN users u ON u.id = a.user_id
        JOIN request r ON r.id = a.request_id
        ${whereSql}
    `;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    // Items
    params.push(pageSize, offset);
    const pLimit = `$${params.length - 1}`;
    const pOffset = `$${params.length}`;

    const itemSql = `
      SELECT
        a.id AS assignment_id,
        u.id AS user_id,
        u.display_name,
        u.email,
        ou.name AS org_unit_name,
        a.status,
        (a.status IN ('unopened','opened') AND r.due_at IS NOT NULL AND r.due_at < now()) AS is_overdue,
        a.opened_at,
        a.responded_at,
        a.action_at,
        (SELECT u2.display_name FROM assignment a2 JOIN users u2 ON u2.id = a2.user_id
           WHERE a2.forwarded_from_assignment_id = a.id LIMIT 1) AS forwarded_to_name,
        (SELECT COUNT(*)::int FROM request_comment rc WHERE rc.assignment_id = a.id) AS comment_count,
        EXISTS (
          SELECT 1 FROM request_comment rc2
           WHERE rc2.assignment_id = a.id
             AND rc2.author_user_id != r.created_by_user_id
             AND (r.last_viewed_by_requester_at IS NULL
                  OR rc2.created_at > r.last_viewed_by_requester_at)
        ) AS has_unread
      FROM assignment a
      JOIN users u ON u.id = a.user_id
      JOIN request r ON r.id = a.request_id
      LEFT JOIN user_org_unit prim_uou ON prim_uou.user_id = u.id AND prim_uou.is_primary = true
      LEFT JOIN org_unit ou ON ou.id = prim_uou.org_unit_id
      ${whereSql}
      ORDER BY u.display_name ASC
      LIMIT ${pLimit} OFFSET ${pOffset}
    `;
    const { rows } = await client.query(itemSql, params);

    // Summary (same filters minus pagination)
    const summarySql = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE a.status = 'unopened')::int AS unopened,
        COUNT(*) FILTER (WHERE a.status = 'opened')::int AS opened,
        COUNT(*) FILTER (WHERE a.status = 'responded')::int AS responded,
        COUNT(*) FILTER (WHERE a.status = 'not_needed')::int AS not_needed,
        COUNT(*) FILTER (WHERE a.status = 'forwarded')::int AS forwarded,
        COUNT(*) FILTER (WHERE a.status = 'substituted')::int AS substituted,
        COUNT(*) FILTER (WHERE a.status = 'exempted')::int AS exempted,
        COUNT(*) FILTER (WHERE a.status = 'expired')::int AS expired,
        COUNT(*) FILTER (WHERE a.status NOT IN ('unopened','opened','responded','not_needed','forwarded','substituted','exempted','expired'))::int AS other,
        COUNT(*) FILTER (WHERE a.status IN ('unopened','opened') AND r.due_at IS NOT NULL AND r.due_at < now())::int AS overdue
      FROM assignment a
      JOIN users u ON u.id = a.user_id
      JOIN request r ON r.id = a.request_id
      ${whereSql}
    `;
    // summary uses same params except the last 2 (limit/offset)
    const summaryParams = params.slice(0, params.length - 2);
    const { rows: sumRows } = await client.query(summarySql, summaryParams);
    const sr = sumRows[0];

    return {
      items: rows.map((r) => ({
        assignmentId: r.assignment_id,
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        orgUnitName: r.org_unit_name ?? null,
        status: r.status as AssignmentStatus,
        isOverdue: r.is_overdue,
        openedAt: r.opened_at ? new Date(r.opened_at).toISOString() : null,
        respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null,
        actionAt: r.action_at ? new Date(r.action_at).toISOString() : null,
        forwardedToName: r.forwarded_to_name ?? null,
        commentCount: r.comment_count,
        hasUnread: r.has_unread,
      })),
      total,
      page,
      pageSize,
      summary: {
        total: sr.total,
        unopened: sr.unopened,
        opened: sr.opened,
        responded: sr.responded,
        notNeeded: sr.not_needed,
        forwarded: sr.forwarded,
        substituted: sr.substituted,
        exempted: sr.exempted,
        expired: sr.expired,
        other: sr.other,
        overdue: sr.overdue,
      },
    };
  });
}
