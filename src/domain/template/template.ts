import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import type { TargetSpec } from '../request/expand-targets';

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'permission_denied' | 'validation',
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

export type TemplateInput = {
  orgUnitId: string;
  title: string;
  body?: string | null;
  estimatedMinutes?: number | null;
  defaultDueOffsetDays?: number | null;
  defaultTargets?: TargetSpec[];
};

export type TemplateRow = {
  id: string;
  orgUnitId: string;
  orgUnitName: string | null;
  title: string;
  body: string | null;
  estimatedMinutes: number | null;
  defaultDueOffsetDays: number | null;
  defaultTargets: TargetSpec[];
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_TITLE = 200;
const MAX_BODY = 20000;

function validate(input: TemplateInput): void {
  if (!input.orgUnitId) throw new TemplateError('orgUnitId required', 'validation');
  if (!input.title?.trim()) throw new TemplateError('title required', 'validation');
  if (input.title.length > MAX_TITLE) throw new TemplateError('title too long', 'validation');
  if (input.body && input.body.length > MAX_BODY) {
    throw new TemplateError('body too long', 'validation');
  }
  if (input.estimatedMinutes != null && input.estimatedMinutes < 0) {
    throw new TemplateError('estimatedMinutes must be >= 0', 'validation');
  }
  if (input.defaultDueOffsetDays != null && input.defaultDueOffsetDays < 0) {
    throw new TemplateError('defaultDueOffsetDays must be >= 0', 'validation');
  }
}

/**
 * Returns the set of org_unit_ids the user belongs to (primary + secondary).
 * tenant_admin gets a special wildcard treatment via the boolean return.
 */
async function userOrgUnits(
  client: pg.PoolClient,
  userId: string,
): Promise<Set<string>> {
  const { rows } = await client.query<{ org_unit_id: string }>(
    `SELECT org_unit_id FROM user_org_unit WHERE user_id = $1`,
    [userId],
  );
  return new Set(rows.map((r) => r.org_unit_id));
}

/**
 * Permission rule (NDG-68): tenant_admin can do anything; otherwise the user
 * must belong to the template's owning org_unit.
 */
async function ensureAccess(
  client: pg.PoolClient,
  actor: ActorContext,
  orgUnitId: string,
): Promise<void> {
  if (actor.isTenantAdmin) return;
  const orgs = await userOrgUnits(client, actor.userId);
  if (!orgs.has(orgUnitId)) {
    throw new TemplateError('not permitted for this org_unit', 'permission_denied');
  }
}

function mapRow(r: {
  id: string;
  org_unit_id: string;
  org_unit_name: string | null;
  title: string;
  body: string | null;
  estimated_minutes: number | null;
  default_due_offset_days: number | null;
  default_targets_json: TargetSpec[] | null;
  created_by_user_id: string;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}): TemplateRow {
  return {
    id: r.id,
    orgUnitId: r.org_unit_id,
    orgUnitName: r.org_unit_name,
    title: r.title,
    body: r.body,
    estimatedMinutes: r.estimated_minutes,
    defaultDueOffsetDays: r.default_due_offset_days,
    defaultTargets: r.default_targets_json ?? [],
    createdByUserId: r.created_by_user_id,
    createdByName: r.created_by_name,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

/**
 * List templates the actor can use.
 * - tenant_admin: all non-archived templates in the tenant
 * - other: templates owned by the actor's org_units only
 */
export async function listTemplates(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<TemplateRow[]> {
  return withTenant(pool, actor.tenantId, async (client) => {
    let where = `WHERE t.archived_at IS NULL`;
    const params: unknown[] = [];
    if (!actor.isTenantAdmin) {
      params.push(actor.userId);
      where += ` AND t.org_unit_id IN (
                   SELECT org_unit_id FROM user_org_unit WHERE user_id = $1
                 )`;
    }
    const { rows } = await client.query(
      `SELECT t.id, t.org_unit_id, ou.name AS org_unit_name,
              t.title, t.body, t.estimated_minutes, t.default_due_offset_days,
              t.default_targets_json,
              t.created_by_user_id, u.display_name AS created_by_name,
              t.created_at, t.updated_at
         FROM request_template t
         LEFT JOIN org_unit ou ON ou.id = t.org_unit_id
         LEFT JOIN users u ON u.id = t.created_by_user_id
         ${where}
        ORDER BY t.updated_at DESC`,
      params,
    );
    return rows.map(mapRow);
  });
}

export async function getTemplate(
  pool: pg.Pool,
  actor: ActorContext,
  id: string,
): Promise<TemplateRow> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT t.id, t.org_unit_id, ou.name AS org_unit_name,
              t.title, t.body, t.estimated_minutes, t.default_due_offset_days,
              t.default_targets_json,
              t.created_by_user_id, u.display_name AS created_by_name,
              t.created_at, t.updated_at
         FROM request_template t
         LEFT JOIN org_unit ou ON ou.id = t.org_unit_id
         LEFT JOIN users u ON u.id = t.created_by_user_id
        WHERE t.id = $1 AND t.archived_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new TemplateError('template not found', 'not_found');
    const row = mapRow(rows[0]);
    await ensureAccess(client, actor, row.orgUnitId);
    return row;
  });
}

export async function createTemplate(
  pool: pg.Pool,
  actor: ActorContext,
  input: TemplateInput,
): Promise<{ id: string }> {
  validate(input);
  return withTenant(pool, actor.tenantId, async (client) => {
    await ensureAccess(client, actor, input.orgUnitId);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO request_template
         (tenant_id, org_unit_id, title, body, estimated_minutes,
          default_due_offset_days, default_targets_json, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING id`,
      [
        actor.tenantId, input.orgUnitId, input.title.trim(),
        input.body ?? null, input.estimatedMinutes ?? null,
        input.defaultDueOffsetDays ?? null,
        JSON.stringify(input.defaultTargets ?? []), actor.userId,
      ],
    );
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'request_template.created', 'request_template', $3, $4::jsonb)`,
      [actor.tenantId, actor.userId, rows[0].id,
       JSON.stringify({ orgUnitId: input.orgUnitId, title: input.title })],
    );
    return { id: rows[0].id };
  });
}

export async function updateTemplate(
  pool: pg.Pool,
  actor: ActorContext,
  id: string,
  input: TemplateInput,
): Promise<void> {
  validate(input);
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: existing } = await client.query<{ org_unit_id: string }>(
      `SELECT org_unit_id FROM request_template WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    if (existing.length === 0) throw new TemplateError('template not found', 'not_found');
    // Caller must have access to BOTH the old org_unit (to take it) and the new one.
    await ensureAccess(client, actor, existing[0].org_unit_id);
    if (existing[0].org_unit_id !== input.orgUnitId) {
      await ensureAccess(client, actor, input.orgUnitId);
    }
    await client.query(
      `UPDATE request_template
          SET org_unit_id = $2,
              title = $3,
              body = $4,
              estimated_minutes = $5,
              default_due_offset_days = $6,
              default_targets_json = $7::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [
        id, input.orgUnitId, input.title.trim(),
        input.body ?? null, input.estimatedMinutes ?? null,
        input.defaultDueOffsetDays ?? null,
        JSON.stringify(input.defaultTargets ?? []),
      ],
    );
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'request_template.updated', 'request_template', $3, $4::jsonb)`,
      [actor.tenantId, actor.userId, id,
       JSON.stringify({ orgUnitId: input.orgUnitId, title: input.title })],
    );
  });
}

export async function archiveTemplate(
  pool: pg.Pool,
  actor: ActorContext,
  id: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const { rows: existing } = await client.query<{ org_unit_id: string }>(
      `SELECT org_unit_id FROM request_template WHERE id = $1 AND archived_at IS NULL`,
      [id],
    );
    if (existing.length === 0) throw new TemplateError('template not found', 'not_found');
    await ensureAccess(client, actor, existing[0].org_unit_id);
    await client.query(
      `UPDATE request_template SET archived_at = now(), updated_at = now() WHERE id = $1`,
      [id],
    );
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'request_template.archived', 'request_template', $3, '{}'::jsonb)`,
      [actor.tenantId, actor.userId, id],
    );
  });
}
