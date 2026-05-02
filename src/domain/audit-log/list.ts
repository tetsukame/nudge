import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class AuditLogError extends Error {
  constructor(message: string, readonly code: 'permission_denied' | 'validation') {
    super(message);
    this.name = 'AuditLogError';
  }
}

export type AuditLogItem = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  payloadJson: Record<string, unknown>;
  createdAt: string;
};

export type ListAuditLogInput = {
  actorUserId?: string;
  action?: string;
  from?: string; // ISO datetime
  to?: string;   // ISO datetime
  page?: number;
  pageSize?: number;
};

export type ListAuditLogResult = {
  items: AuditLogItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Distinct action values present in this tenant — populated for UI dropdown filling */
  actions: string[];
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function listAuditLog(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListAuditLogInput,
): Promise<ListAuditLogResult> {
  if (!actor.isTenantAdmin) {
    throw new AuditLogError('tenant_admin required', 'permission_denied');
  }
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;

  return withTenant(pool, actor.tenantId, async (client) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (input.actorUserId) {
      params.push(input.actorUserId);
      where.push(`a.actor_user_id = $${params.length}`);
    }
    if (input.action) {
      params.push(input.action);
      where.push(`a.action = $${params.length}`);
    }
    if (input.from) {
      params.push(input.from);
      where.push(`a.created_at >= $${params.length}`);
    }
    if (input.to) {
      params.push(input.to);
      where.push(`a.created_at <= $${params.length}`);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const { rows: countRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_log a ${whereSql}`,
      params,
    );
    const total = parseInt(countRows[0].n, 10);

    const { rows: actionRows } = await client.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log ORDER BY action ASC`,
    );
    const actions = actionRows.map((r) => r.action);

    params.push(pageSize, offset);
    const { rows } = await client.query<{
      id: string;
      actor_user_id: string | null;
      actor_name: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      payload_json: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT a.id, a.actor_user_id, u.display_name AS actor_name,
              a.action, a.target_type, a.target_id, a.payload_json, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
         ${whereSql}
        ORDER BY a.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        actorName: r.actor_name,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        payloadJson: r.payload_json ?? {},
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total,
      page,
      pageSize,
      actions,
    };
  });
}
