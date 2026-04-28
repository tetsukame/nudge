import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  openAssignment,
  respondAssignment,
  notNeededAssignment,
  forwardAssignment,
  substituteAssignment,
  exemptAssignment,
  AssignmentActionError,
} from '../../../../src/domain/assignment/actions.js';
import type { ActorContext } from '../../../../src/domain/types.js';

async function seedAssignment(
  s: Awaited<ReturnType<typeof createDomainScenario>>,
  userId: string,
): Promise<{ requestId: string; assignmentId: string }> {
  const pool = getPool();
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','t','active')`,
    [requestId, s.tenantId, s.users.admin],
  );
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assignment(tenant_id, request_id, user_id)
     VALUES ($1,$2,$3) RETURNING id`,
    [s.tenantId, requestId, userId],
  );
  return { requestId, assignmentId: rows[0].id };
}

function ctx(s: { tenantId: string }, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('assignment actions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('openAssignment transitions unopened → opened and sets action_at', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await openAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId);
    const { rows } = await getPool().query(
      `SELECT status, opened_at, action_at FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('opened');
    expect(rows[0].opened_at).not.toBeNull();
    expect(rows[0].action_at).not.toBeNull();
  });

  it('respondAssignment unopened → responded with history row', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, { note: 'done' });
    const { rows } = await getPool().query(
      `SELECT status, responded_at FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('responded');
    const { rows: h } = await getPool().query(
      `SELECT transition_kind, reason FROM assignment_status_history
        WHERE assignment_id=$1 ORDER BY created_at`,
      [assignmentId],
    );
    expect(h[0].transition_kind).toBe('user_respond');
  });

  it('notNeededAssignment requires reason', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      notNeededAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: '' }),
    ).rejects.toBeInstanceOf(AssignmentActionError);
  });

  it('forwardAssignment creates new assignment linked via forwarded_from_assignment_id', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentId } = await seedAssignment(s, s.users.memberA);
    const result = await forwardAssignment(
      getAppPool(), ctx(s, s.users.memberA), assignmentId,
      { toUserId: s.users.memberB, reason: 'over capacity' },
    );
    expect(result.newAssignmentId).toBeDefined();
    const { rows } = await getPool().query(
      `SELECT id, user_id, status, forwarded_from_assignment_id
         FROM assignment WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('forwarded');
    expect(rows[1].user_id).toBe(s.users.memberB);
    expect(rows[1].status).toBe('unopened');
    expect(rows[1].forwarded_from_assignment_id).toBe(assignmentId);
  });

  it('forwardAssignment records system comment if target already has assignment for this request', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentId } = await seedAssignment(s, s.users.memberA);
    const { rows: existing } = await getPool().query<{ id: string }>(
      `INSERT INTO assignment(tenant_id, request_id, user_id)
       VALUES ($1,$2,$3) RETURNING id`,
      [s.tenantId, requestId, s.users.memberB],
    );
    const existingId = existing[0].id;
    const result = await forwardAssignment(
      getAppPool(), ctx(s, s.users.memberA), assignmentId,
      { toUserId: s.users.memberB, reason: 'x' },
    );
    // Should return the existing assignment id
    expect(result.newAssignmentId).toBe(existingId);
    // Should have recorded a comment on the existing assignment thread
    const { rows: comments } = await getPool().query(
      `SELECT body FROM request_comment WHERE assignment_id=$1`,
      [existingId],
    );
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments[0].body).toMatch(/転送/);
  });

  it('substituteAssignment by requester succeeds', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.admin),
      assignmentId, { reason: 'on behalf' },
    );
    const { rows } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('substituted');
  });

  it('substituteAssignment by non-requester non-manager rejected', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      substituteAssignment(
        getAppPool(), ctx(s, s.users.outsider), assignmentId, { reason: 'x' },
      ),
    ).rejects.toBeInstanceOf(AssignmentActionError);
  });

  it('exemptAssignment requires tenant_admin role', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      exemptAssignment(
        getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: 'x' },
      ),
    ).rejects.toBeInstanceOf(AssignmentActionError);
    await exemptAssignment(
      getAppPool(), ctx(s, s.users.admin, { isTenantAdmin: true }),
      assignmentId, { reason: 'duplicate' },
    );
    const { rows } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('exempted');
  });

  it('terminal status is irreversible', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, {});
    await expect(
      respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, {}),
    ).rejects.toBeInstanceOf(AssignmentActionError);
  });

  it('substituteAssignment records system message in assignee chat', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.admin),
      assignmentId, { reason: 'taking over' },
    );
    const { rows } = await getPool().query(
      `SELECT body, author_user_id FROM request_comment
        WHERE assignment_id=$1 ORDER BY created_at`,
      [assignmentId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const systemMsg = rows.find((r) => r.author_user_id === s.users.admin);
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.body).toMatch(/代理完了/);
    expect(systemMsg!.body).toMatch(/taking over/);
  });

  it('respondAssignment emits completed notification to requester', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, {});

    const { rows } = await getPool().query(
      `SELECT recipient_user_id, channel, kind, payload_json
         FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2`,
      [requestId, s.users.admin],
    );
    expect(rows.length).toBeGreaterThan(0);
    const inApp = rows.find((r) => r.channel === 'in_app');
    expect(inApp).toBeDefined();
    expect(inApp!.payload_json.action).toBe('responded');
    expect(inApp!.payload_json.completedBy).toBeDefined();
  });

  it('respondAssignment does NOT emit completed when requester is also the assignee', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = randomUUID();
    await getPool().query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','self','active')`,
      [reqId, s.tenantId, s.users.admin],
    );
    const { rows: asgRows } = await getPool().query<{ id: string }>(
      `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1,$2,$3) RETURNING id`,
      [s.tenantId, reqId, s.users.admin],
    );
    const assignmentId = asgRows[0].id;

    await respondAssignment(getAppPool(), ctx(s, s.users.admin), assignmentId, {});

    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification
        WHERE request_id=$1 AND kind='completed'`,
      [reqId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('notNeededAssignment emits completed with action=not_needed', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await notNeededAssignment(
      getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: 'busy' },
    );

    const { rows } = await getPool().query(
      `SELECT payload_json FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2 AND channel='in_app'`,
      [requestId, s.users.admin],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.action).toBe('not_needed');
  });

  it('substituteAssignment by non-requester emits completed with action=substituted', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    // manager substitutes (manager is not the requester, admin is)
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.manager), assignmentId, { reason: 'manager step in' },
    );
    const { rows } = await getPool().query(
      `SELECT payload_json FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2 AND channel='in_app'`,
      [requestId, s.users.admin],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.action).toBe('substituted');
  });

  it('substituteAssignment by requester suppresses requester-side completed', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    // admin (the requester) substitutes — should NOT emit completed to admin (self)
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.admin), assignmentId, { reason: 'taking over' },
    );
    const { rows } = await getPool().query(
      `SELECT recipient_user_id FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2`,
      [requestId, s.users.admin],
    );
    // Self-completion suppressed: admin is requester, no completed row to admin
    expect(rows.length).toBe(0);
  });
});
