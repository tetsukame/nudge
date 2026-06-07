import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { ROLE } from '../_constants';

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
  targetType?: string;
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
  /** Distinct target_type values present in this tenant */
  targetTypes: string[];
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// NDG-67: CSV export cap — 全件出力で OOM を避けつつ実運用での監査エクスポートを賄う
const CSV_EXPORT_MAX_ROWS = 10000;

/**
 * NDG-67: tenant_admin or auditor can view audit log.
 * The check goes directly to user_role (not ActorContext) so existing
 * call sites that pass `isTenantAdmin: true` keep working, while we also
 * grant access to the new auditor role transparently.
 */
async function ensurePermission(client: pg.PoolClient, actorUserId: string): Promise<void> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM user_role
        WHERE user_id = $1 AND role = ANY($2::text[])
     ) AS ok`,
    [actorUserId, [ROLE.TENANT_ADMIN, ROLE.AUDITOR]],
  );
  if (!rows[0].ok) {
    throw new AuditLogError('tenant_admin or auditor required', 'permission_denied');
  }
}

function buildWhere(input: ListAuditLogInput): { whereSql: string; params: unknown[] } {
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
  if (input.targetType) {
    params.push(input.targetType);
    where.push(`a.target_type = $${params.length}`);
  }
  if (input.from) {
    params.push(input.from);
    where.push(`a.created_at >= $${params.length}`);
  }
  if (input.to) {
    params.push(input.to);
    where.push(`a.created_at <= $${params.length}`);
  }
  return { whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listAuditLog(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListAuditLogInput,
): Promise<ListAuditLogResult> {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE)));
  const offset = (page - 1) * pageSize;

  return withTenant(pool, actor.tenantId, async (client) => {
    await ensurePermission(client, actor.userId);

    const { whereSql, params } = buildWhere(input);

    const { rows: countRows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM audit_log a ${whereSql}`,
      params,
    );
    const total = parseInt(countRows[0].n, 10);

    const { rows: actionRows } = await client.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log ORDER BY action ASC`,
    );
    const actions = actionRows.map((r) => r.action);

    const { rows: targetTypeRows } = await client.query<{ target_type: string }>(
      `SELECT DISTINCT target_type FROM audit_log ORDER BY target_type ASC`,
    );
    const targetTypes = targetTypeRows.map((r) => r.target_type);

    const pagedParams = [...params, pageSize, offset];
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
        LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`,
      pagedParams,
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
      targetTypes,
    };
  });
}

export type AuditLogCsvResult = {
  csv: string;
  rowCount: number;
  truncated: boolean;
};

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportAuditLogCsv(
  pool: pg.Pool,
  actor: ActorContext,
  input: Omit<ListAuditLogInput, 'page' | 'pageSize'>,
): Promise<AuditLogCsvResult> {
  return withTenant(pool, actor.tenantId, async (client) => {
    await ensurePermission(client, actor.userId);

    const { whereSql, params } = buildWhere(input);
    const cappedParams = [...params, CSV_EXPORT_MAX_ROWS + 1];

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
        LIMIT $${cappedParams.length}`,
      cappedParams,
    );

    const truncated = rows.length > CSV_EXPORT_MAX_ROWS;
    const exportRows = truncated ? rows.slice(0, CSV_EXPORT_MAX_ROWS) : rows;

    const header = [
      'created_at',
      'actor_user_id',
      'actor_name',
      'action',
      'target_type',
      'target_id',
      'payload_json',
    ].join(',');
    const body = exportRows.map((r) => [
      new Date(r.created_at).toISOString(),
      r.actor_user_id ?? '',
      r.actor_name ?? '',
      r.action,
      r.target_type,
      r.target_id ?? '',
      JSON.stringify(r.payload_json ?? {}),
    ].map((v) => csvEscape(String(v))).join(',')).join('\n');

    return {
      csv: header + '\n' + body + (body ? '\n' : ''),
      rowCount: exportRows.length,
      truncated,
    };
  });
}
