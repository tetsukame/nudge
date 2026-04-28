import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext, AssignmentStatus } from '../types';
import { canTransition } from './transitions';
import { canSubstitute } from './permissions';
import { emitNotification } from '../notification/emit';

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
  request_title: string;
};

async function loadLocked(
  client: pg.PoolClient,
  assignmentId: string,
): Promise<AssignmentRow> {
  const { rows } = await client.query<AssignmentRow>(
    `SELECT a.id, a.request_id, a.user_id, a.status::text AS status,
            r.created_by_user_id, r.title AS request_title
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

async function emitCompletedToRequester(
  client: pg.PoolClient,
  actor: ActorContext,
  asg: AssignmentRow,
  action: 'responded' | 'not_needed' | 'substituted',
): Promise<void> {
  if (asg.created_by_user_id === actor.userId) return; // suppress self-completion
  const { rows: actorRows } = await client.query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1`,
    [actor.userId],
  );
  const completedBy = actorRows[0]?.display_name ?? 'ユーザー';
  await emitNotification(client, {
    tenantId: actor.tenantId,
    recipientUserId: asg.created_by_user_id,
    requestId: asg.request_id,
    assignmentId: asg.id,
    kind: 'completed',
    payload: {
      title: asg.request_title,
      completedBy,
      action,
    },
  });
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
    await emitCompletedToRequester(client, actor, asg, 'responded');
  });
}

export async function notNeededAssignment(
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
    if (!canTransition({ from: asg.status, to: 'not_needed', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot mark not_needed', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='not_needed', action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'not_needed', 'user_not_needed',
      actor.userId, input.reason, null,
    );
    await emitCompletedToRequester(client, actor, asg, 'not_needed');
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
    // Check if target already has an assignment for this request
    const { rows: dup } = await client.query<{ id: string }>(
      `SELECT id FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [asg.request_id, input.toUserId],
    );

    await client.query(
      `UPDATE assignment SET status='forwarded', action_at=now() WHERE id=$1`,
      [assignmentId],
    );

    // Get forwarding user's name for the chat message
    const { rows: actorRows } = await client.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id=$1`,
      [actor.userId],
    );
    const actorName = actorRows[0]?.display_name ?? actor.userId;

    let newAssignmentId: string;

    if (dup.length > 0) {
      // Target already has assignment — don't create a new one.
      // Record a system comment on their existing assignment thread.
      newAssignmentId = dup[0].id;
      const msg = `${actorName} さんからこの依頼が転送されました。`
        + (input.reason ? `\n理由: ${input.reason}` : '');
      await client.query(
        `INSERT INTO request_comment
           (tenant_id, request_id, assignment_id, author_user_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [actor.tenantId, asg.request_id, newAssignmentId, actor.userId, msg],
      );
    } else {
      // Create new assignment for target
      const { rows: newRows } = await client.query<{ id: string }>(
        `INSERT INTO assignment
           (tenant_id, request_id, user_id, forwarded_from_assignment_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [actor.tenantId, asg.request_id, input.toUserId, asg.id],
      );
      newAssignmentId = newRows[0].id;
    }

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
      // Record system message in the assignee's chat thread
      const { rows: actorRows } = await client.query<{ display_name: string }>(
        `SELECT display_name FROM users WHERE id=$1`,
        [actor.userId],
      );
      const actorName = actorRows[0]?.display_name ?? actor.userId;
      const msg = `${actorName} さんが代理完了にしました。\n理由: ${input.reason}`;
      await client.query(
        `INSERT INTO request_comment
           (tenant_id, request_id, assignment_id, author_user_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [actor.tenantId, asg.request_id, asg.id, actor.userId, msg],
      );
      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: asg.user_id,
        requestId: asg.request_id,
        assignmentId: asg.id,
        kind: 'completed',
        payload: { substitutedBy: actor.userId, reason: input.reason },
      });
    }
    await emitCompletedToRequester(client, actor, asg, 'substituted');
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
