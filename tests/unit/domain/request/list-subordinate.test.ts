import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { listSubordinateRequests } from '../../../../src/domain/request/list-subordinate.js';
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
    `INSERT INTO request(id, tenant_id, created_by_user_id, title, status)
     VALUES ($1,$2,$3,'sub req','active')`,
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

describe('listSubordinateRequests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('manager sees request with subordinate (memberA) + outsider: total=1 (only memberA counted)', async () => {
    const s = await createDomainScenario(getPool());

    // Request has both memberA (subordinate of manager via orgDiv→orgTeam) and outsider (in orgSibling)
    const { requestId, assignmentIds } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.outsider],
    );

    const result = await listSubordinateRequests(getAppPool(), ctx(s, s.users.manager), {});
    const item = result.items.find((i) => i.id === requestId);
    expect(item).toBeDefined();
    // Only memberA is a subordinate; outsider is NOT counted
    expect(item!.total).toBe(1);
    // memberA is unopened
    expect(item!.unopened).toBe(1);
    // outsider's assignment is NOT reflected in the counts
    expect(item!.total).not.toBe(2);
  });

  it('non-manager user gets empty list', async () => {
    const s = await createDomainScenario(getPool());

    // Seed a request for memberA (memberB is NOT a manager)
    await seedRequest(s, s.users.admin, [s.users.memberA]);

    const result = await listSubordinateRequests(getAppPool(), ctx(s, s.users.memberB), {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });
});
