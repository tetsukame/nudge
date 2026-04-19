import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { listAssignees, AssigneesError } from '../../../../src/domain/request/assignees.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(s: { tenantId: string }, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

async function seedRequest(
  s: Awaited<ReturnType<typeof createDomainScenario>>,
  creatorId: string,
  assigneeIds: string[],
): Promise<{ requestId: string; assignmentIds: string[] }> {
  const pool = getPool();
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','assignees test req','active')`,
    [requestId, s.tenantId, creatorId],
  );
  const assignmentIds: string[] = [];
  for (const userId of assigneeIds) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1,$2,$3) RETURNING id`,
      [s.tenantId, requestId, userId],
    );
    assignmentIds.push(rows[0].id);
  }
  return { requestId, assignmentIds };
}

describe('listAssignees', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester sees all 3 assignees with summary', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.memberB, s.users.outsider],
    );

    const result = await listAssignees(
      getAppPool(), ctx(s, s.users.admin, { isTenantAdmin: true }),
      requestId, {},
    );
    expect(result.total).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.unopened).toBe(3);
  });

  it('manager sees only subordinates (memberA visible, outsider NOT)', async () => {
    const s = await createDomainScenario(getPool());
    // Request created by admin, assigned to memberA (subordinate of manager) + outsider
    const { requestId } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.outsider],
    );

    const result = await listAssignees(
      getAppPool(), ctx(s, s.users.manager),
      requestId, {},
    );
    expect(result.total).toBe(1);
    const emails = result.items.map((i) => i.email);
    expect(emails).toContain('a@test');
    expect(emails).not.toContain('out@test');
  });

  it('outsider gets AssigneesError', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId } = await seedRequest(s, s.users.admin, [s.users.memberA]);

    await expect(
      listAssignees(getAppPool(), ctx(s, s.users.outsider), requestId, {}),
    ).rejects.toBeInstanceOf(AssigneesError);
  });

  it('filter by orgUnitId: orgTeam only — memberA visible, outsider not', async () => {
    const s = await createDomainScenario(getPool());
    // memberA is in orgTeam; outsider is in orgSibling
    const { requestId } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.outsider],
    );

    const result = await listAssignees(
      getAppPool(), ctx(s, s.users.admin, { isTenantAdmin: true }),
      requestId, { orgUnitId: s.orgTeam },
    );
    const emails = result.items.map((i) => i.email);
    expect(emails).toContain('a@test');
    expect(emails).not.toContain('out@test');
  });

  it('filter by status: only unopened returned', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentIds } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.memberB],
    );
    // Set memberA to responded
    await getPool().query(
      `UPDATE assignment SET status='responded', responded_at=now() WHERE id=$1`,
      [assignmentIds[0]],
    );

    const result = await listAssignees(
      getAppPool(), ctx(s, s.users.admin, { isTenantAdmin: true }),
      requestId, { statuses: ['unopened'] },
    );
    expect(result.total).toBe(1);
    expect(result.items[0].status).toBe('unopened');
    // memberA is not returned
    expect(result.items.map((i) => i.email)).not.toContain('a@test');
  });

  it('commentCount and hasUnread work — insert comment from assignee, verify hasUnread=true', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentIds } = await seedRequest(
      s, s.users.admin, [s.users.memberA],
    );
    const assignmentId = assignmentIds[0];

    // Insert a comment from memberA (not the requester=admin)
    await getPool().query(
      `INSERT INTO request_comment(tenant_id, request_id, assignment_id, author_user_id, body)
       VALUES ($1, $2, $3, $4, 'question from memberA')`,
      [s.tenantId, requestId, assignmentId, s.users.memberA],
    );

    const result = await listAssignees(
      getAppPool(), ctx(s, s.users.admin, { isTenantAdmin: true }),
      requestId, {},
    );
    const item = result.items.find((i) => i.email === 'a@test');
    expect(item).toBeDefined();
    expect(item!.commentCount).toBe(1);
    expect(item!.hasUnread).toBe(true);
  });
});
