import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext, ExpandBreakdown } from '../types';
import { expandTargets, type TargetSpec } from './expand-targets';
import {
  canTargetOutsideScope,
  getVisibleOrgUnitIds,
  getVisibleGroupIds,
} from './permissions';
import { emitNotification } from '../notification/emit';

export type CreateRequestInput = {
  title: string;
  body: string;
  dueAt: string; // ISO8601
  type: 'survey' | 'task';
  estimatedMinutes?: number;
  targets: TargetSpec[];
};

export type CreateRequestResult = {
  id: string;
  expandedCount: number;
  breakdown: ExpandBreakdown;
};

export class CreateRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'permission_denied'
      | 'invalid_targets'
      | 'empty_expansion'
      | 'validation',
  ) {
    super(message);
    this.name = 'CreateRequestError';
  }
}

export async function createRequest(
  pool: pg.Pool,
  actor: ActorContext,
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  if (!input.title.trim()) {
    throw new CreateRequestError('title required', 'validation');
  }
  if (input.targets.length === 0) {
    throw new CreateRequestError('targets required', 'validation');
  }
  const estimatedMinutes = input.estimatedMinutes ?? 5;
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0) {
    throw new CreateRequestError('estimatedMinutes must be a positive integer', 'validation');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    const hasAll = input.targets.some((t) => t.type === 'all');
    if (hasAll && !canTargetOutsideScope(actor)) {
      throw new CreateRequestError(
        'tenant-wide target requires permission',
        'permission_denied',
      );
    }

    if (!canTargetOutsideScope(actor)) {
      const visibleOrgs = new Set(await getVisibleOrgUnitIds(client, actor.userId));
      const visibleGroups = new Set(await getVisibleGroupIds(client, actor.userId));
      for (const t of input.targets) {
        if (t.type === 'org_unit' && !visibleOrgs.has(t.orgUnitId)) {
          throw new CreateRequestError(
            `org_unit ${t.orgUnitId} outside visible scope`,
            'permission_denied',
          );
        }
        if (t.type === 'group' && !visibleGroups.has(t.groupId)) {
          throw new CreateRequestError(
            `group ${t.groupId} outside visible scope`,
            'permission_denied',
          );
        }
        if (t.type === 'user') {
          const { rows } = await client.query<{ ok: boolean }>(
            `SELECT EXISTS(
               SELECT 1 FROM user_org_unit uou
               WHERE uou.user_id = $1
                 AND uou.org_unit_id = ANY($2::uuid[])
             ) AS ok`,
            [t.userId, [...visibleOrgs]],
          );
          if (!rows[0].ok) {
            throw new CreateRequestError(
              `user ${t.userId} outside visible scope`,
              'permission_denied',
            );
          }
        }
      }
    }

    const { rows: reqRows } = await client.query<{ id: string }>(
      `INSERT INTO request
         (tenant_id, created_by_user_id, type, title, body, due_at, status, estimated_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
       RETURNING id`,
      [actor.tenantId, actor.userId, input.type, input.title, input.body, input.dueAt, estimatedMinutes],
    );
    const requestId = reqRows[0].id;

    for (const t of input.targets) {
      if (t.type === 'user') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
           VALUES ($1, $2, 'user', $3)`,
          [actor.tenantId, requestId, t.userId],
        );
      } else if (t.type === 'org_unit') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id, include_descendants)
           VALUES ($1, $2, 'org_unit', $3, $4)`,
          [actor.tenantId, requestId, t.orgUnitId, t.includeDescendants],
        );
      } else if (t.type === 'group') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
           VALUES ($1, $2, 'group', $3)`,
          [actor.tenantId, requestId, t.groupId],
        );
      } else if (t.type === 'all') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
           VALUES ($1, $2, 'all', NULL)`,
          [actor.tenantId, requestId],
        );
      }
    }

    const breakdown = await expandTargets(client, actor.tenantId, requestId, input.targets);
    const expandedCount =
      breakdown.user + breakdown.org_unit + breakdown.group + breakdown.all;

    if (expandedCount === 0) {
      throw new CreateRequestError('no targets expanded', 'empty_expansion');
    }

    const { rows: asgRows } = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM assignment WHERE request_id = $1`,
      [requestId],
    );
    for (const a of asgRows) {
      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: a.user_id,
        requestId,
        assignmentId: a.id,
        kind: 'created',
        payload: { title: input.title },
      });
    }

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'request.created', 'request', $3, $4::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        requestId,
        JSON.stringify({ expandedCount, breakdown }),
      ],
    );

    return { id: requestId, expandedCount, breakdown };
  });
}
