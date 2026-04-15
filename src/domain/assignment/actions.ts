import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext, AssignmentStatus } from '../types.js';
import { canTransition } from './transitions.js';
import { canSubstitute } from './permissions.js';
import { emitNotification } from '../notification/emit.js';

export class AssignmentActionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'permission_denied'
      | 'invalid_transition'
      | 'validation'
      | 'conflict',
  ) {
    super(message);
    this.name = 'AssignmentActionError';
  }
}

type AssignmentRow = {
  id: string;
  request_id: string;
  user_id: string;
  status: AssignmentStatus;
  created_by_user_id: string;
};

async function loadLocked(
  client: pg.PoolClient,
  assignmentId: string,
): Promise<AssignmentRow> {
  const { rows } = await client.query<AssignmentRow>(
    `SELECT a.id, a.request_id, a.user_id, a.status::text AS status,
            r.created_by_user_id
       FROM assignment a
       JOIN request r ON r.id = a.request_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [assignmentId],
  );
  if (rows.length === 0) {
    throw new AssignmentActionError('assignment not found', 'not_found');
  }
  return rows[0];
}

async function recordHistory(
  client: pg.PoolClient,
  tenantId: string,
  asg: AssignmentRow,
  to: AssignmentStatus,
  transitionKind: string,
  actorUserId: string,
  reason: string | null,
  forwardedToUserId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO assignment_status_history
       (tenant_id, assignment_id, from_status, to_status, transition_kind,
        transitioned_by_user_id, reason, forwarded_to_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenantId, asg.id, asg.status, to, transitionKind, actorUserId, reason, forwardedToUserId],
  );
}

export async function openAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (asg.status !== 'unopened') return; // idempotent: already opened or terminal
    if (!canTransition({ from: asg.status, to: 'opened', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot open', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='opened', opened_at=now(), action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(client, actor.tenantId, asg, 'opened', 'auto_open', actor.userId, null, null);
  });
}

export async function respondAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { note?: string },
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (!canTransition({ from: asg.status, to: 'responded', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot respond', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='responded', responded_at=now(), action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'responded', 'user_respond',
      actor.userId, input.note ?? null, null,
    );
  });
}

export async function unavailableAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { reason: string },
): Promise<void> {
  if (!input.reason?.trim()) {
    throw new AssignmentActionError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (!canTransition({ from: asg.status, to: 'unavailable', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot mark unavailable', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='unavailable', action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'unavailable', 'user_unavailable',
      actor.userId, input.reason, null,
    );
  });
}

export async function forwardAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { toUserId: string; reason?: string },
): Promise<{ newAssignmentId: string }> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (!canTransition({ from: asg.status, to: 'forwarded', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot forward', 'invalid_transition');
    }
    const { rows: dup } = await client.query(
      `SELECT 1 FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [asg.request_id, input.toUserId],
    );
    if (dup.length > 0) {
      throw new AssignmentActionError(
        `target user already has assignment for this request`,
        'conflict',
      );
    }
    await client.query(
      `UPDATE assignment SET status='forwarded', action_at=now() WHERE id=$1`,
      [assignmentId],
    );
    const { rows: newRows } = await client.query<{ id: string }>(
      `INSERT INTO assignment
         (tenant_id, request_id, user_id, forwarded_from_assignment_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [actor.tenantId, asg.request_id, input.toUserId, asg.id],
    );
    const newAssignmentId = newRows[0].id;
    await recordHistory(
      client, actor.tenantId, asg, 'forwarded', 'user_forward',
      actor.userId, input.reason ?? null, input.toUserId,
    );
    await emitNotification(client, {
      tenantId: actor.tenantId,
      recipientUserId: input.toUserId,
      requestId: asg.request_id,
      assignmentId: newAssignmentId,
      kind: 'created',
      payload: { forwardedFrom: actor.userId },
    });
    return { newAssignmentId };
  });
}

export async function substituteAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { reason: string },
): Promise<void> {
  if (!input.reason?.trim()) {
    throw new AssignmentActionError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    const allowed = await canSubstitute(
      client,
      { requesterId: asg.created_by_user_id, assigneeId: asg.user_id },
      actor.userId,
    );
    if (!allowed) {
      throw new AssignmentActionError('not permitted to substitute', 'permission_denied');
    }
    const canAsRequester = actor.userId === asg.created_by_user_id
      && canTransition({ from: asg.status, to: 'substituted', actorRole: 'requester' });
    const canAsManager = canTransition({ from: asg.status, to: 'substituted', actorRole: 'manager' });
    if (!canAsRequester && !canAsManager) {
      throw new AssignmentActionError('cannot substitute', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment SET status='substituted', action_at=now() WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'substituted', 'manager_substitute',
      actor.userId, input.reason, null,
    );
    if (actor.userId !== asg.user_id) {
      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: asg.user_id,
        requestId: asg.request_id,
        assignmentId: asg.id,
        kind: 'completed',
        payload: { substitutedBy: actor.userId, reason: input.reason },
      });
    }
  });
}

export async function exemptAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { reason: string },
): Promise<void> {
  if (!actor.isTenantAdmin) {
    throw new AssignmentActionError('tenant_admin required', 'permission_denied');
  }
  if (!input.reason?.trim()) {
    throw new AssignmentActionError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (!canTransition({ from: asg.status, to: 'exempted', actorRole: 'tenant_admin' })) {
      throw new AssignmentActionError('cannot exempt', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment SET status='exempted', action_at=now() WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'exempted', 'admin_exempt',
      actor.userId, input.reason, null,
    );
  });
}
