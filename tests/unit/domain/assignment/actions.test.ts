import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  openAssignment,
  respondAssignment,
  unavailableAssignment,
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

  it('unavailableAssignment requires reason', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      unavailableAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: '' }),
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

  it('forwardAssignment rejects if target already has assignment for this request', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentId } = await seedAssignment(s, s.users.memberA);
    await getPool().query(
      `INSERT INTO assignment(tenant_id, request_id, user_id)
       VALUES ($1,$2,$3)`,
      [s.tenantId, requestId, s.users.memberB],
    );
    await expect(
      forwardAssignment(
        getAppPool(), ctx(s, s.users.memberA), assignmentId,
        { toUserId: s.users.memberB, reason: 'x' },
      ),
    ).rejects.toThrow(/already has assignment/);
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
});
