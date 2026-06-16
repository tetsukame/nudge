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
import { AUDIT_ACTION, MAX_REQUEST_TITLE, MAX_REQUEST_BODY } from '../_constants';

export type CreateRequestInput = {
  title: string;
  body: string;
  dueAt: string; // ISO8601
  estimatedMinutes?: number;
  // undefined: use the user's primary org_unit (default)
  // null:      explicit personal request (no sender org)
  // string:    UUID of an org_unit the user belongs to
  senderOrgUnitId?: string | null;
  targets: TargetSpec[];
  /**
   * NDG-70: If set to a future ISO datetime, the request is stored as
   * status='draft' with scheduled_at set; the worker will activate it (and
   * emit 'created' notifications) when scheduled_at <= now().
   * If omitted or in the past, the request is created with status='active'
   * immediately, exactly like before.
   */
  scheduledAt?: string;
};

export type CreateRequestResult = {
  id: string;
  expandedCount: number;
  breakdown: ExpandBreakdown;
  /** True when the request was created in scheduled (draft) state. */
  scheduled: boolean;
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
  // NDG-95 (S5): 自由入力欄の文字数上限。template と揃える。
  if (input.title.length > MAX_REQUEST_TITLE) {
    throw new CreateRequestError(
      `title too long (max ${MAX_REQUEST_TITLE})`,
      'validation',
    );
  }
  if (input.body && input.body.length > MAX_REQUEST_BODY) {
    throw new CreateRequestError(
      `body too long (max ${MAX_REQUEST_BODY})`,
      'validation',
    );
  }
  if (input.targets.length === 0) {
    throw new CreateRequestError('targets required', 'validation');
  }
  const estimatedMinutes = input.estimatedMinutes ?? 5;
  if (!Number.isInteger(estimatedMinutes) || estimatedMinutes <= 0) {
    throw new CreateRequestError('estimatedMinutes must be a positive integer', 'validation');
  }

  // NDG-70: scheduled send. Only future timestamps count as "scheduled" — a past
  // or current value falls through to immediate send (status='active'). This
  // matches the user expectation of the checkbox being ignorable.
  let scheduledAtIso: string | null = null;
  if (input.scheduledAt) {
    const t = Date.parse(input.scheduledAt);
    if (Number.isNaN(t)) {
      throw new CreateRequestError('scheduledAt is not a valid datetime', 'validation');
    }
    if (t > Date.now()) {
      scheduledAtIso = new Date(t).toISOString();
    }
  }
  const initialStatus = scheduledAtIso ? 'draft' : 'active';

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

    // Resolve sender_org_unit_id:
    //  - undefined → look up actor's is_primary org_unit (NULL if none).
    //  - null      → explicit personal request (NULL).
    //  - string    → validate the actor belongs to it.
    let senderOrgUnitId: string | null;
    if (input.senderOrgUnitId === null) {
      senderOrgUnitId = null;
    } else if (input.senderOrgUnitId === undefined) {
      const { rows } = await client.query<{ org_unit_id: string }>(
        `SELECT org_unit_id FROM user_org_unit
          WHERE user_id = $1 AND is_primary = true
          LIMIT 1`,
        [actor.userId],
      );
      senderOrgUnitId = rows[0]?.org_unit_id ?? null;
    } else {
      const { rows } = await client.query<{ ok: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM user_org_unit
            WHERE user_id = $1 AND org_unit_id = $2
         ) AS ok`,
        [actor.userId, input.senderOrgUnitId],
      );
      if (!rows[0].ok) {
        throw new CreateRequestError(
          'senderOrgUnitId is not one of the actor\'s org_units',
          'validation',
        );
      }
      senderOrgUnitId = input.senderOrgUnitId;
    }

    const { rows: reqRows } = await client.query<{ id: string }>(
      `INSERT INTO request
         (tenant_id, created_by_user_id, title, body, due_at, status,
          estimated_minutes, sender_org_unit_id, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $8, $6, $7, $9)
       RETURNING id`,
      [
        actor.tenantId, actor.userId, input.title, input.body,
        input.dueAt, estimatedMinutes, senderOrgUnitId,
        initialStatus, scheduledAtIso,
      ],
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

    // NDG-70: For scheduled (draft) requests, skip 'created' notifications.
    // The worker emits them when scheduled_at <= now() and the status flips
    // to 'active'. Assignments are still created immediately so the requester
    // can review the recipient list, and so the worker has nothing to expand.
    if (initialStatus === 'active') {
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
    }

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $5, 'request', $3, $4::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        requestId,
        JSON.stringify({ expandedCount, breakdown, scheduledAt: scheduledAtIso }),
        scheduledAtIso ? AUDIT_ACTION.REQUEST_SCHEDULED : AUDIT_ACTION.REQUEST_CREATED,
      ],
    );

    return { id: requestId, expandedCount, breakdown, scheduled: scheduledAtIso != null };
  });
}
