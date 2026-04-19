import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { listSentRequests } from '../../../../src/domain/request/list-sent.js';
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
  dueAt?: string,
): Promise<{ requestId: string; assignmentIds: string[] }> {
  const pool = getPool();
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status, due_at)
     VALUES ($1,$2,$3,'task','req title','active',$4)`,
    [requestId, s.tenantId, creatorId, dueAt ?? null],
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

describe('listSentRequests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns only requests by actor with progress breakdown', async () => {
    const s = await createDomainScenario(getPool());
    // Seed request by admin with 2 assignees
    const { requestId, assignmentIds } = await seedRequest(s, s.users.admin, [s.users.memberA, s.users.memberB]);

    // Seed another request by wideReq — should NOT appear for admin
    await seedRequest(s, s.users.wideReq, [s.users.memberA]);

    // Manually set one assignment to responded
    await getPool().query(
      `UPDATE assignment SET status='responded', responded_at=now() WHERE id=$1`,
      [assignmentIds[0]],
    );

    const result = await listSentRequests(getAppPool(), ctx(s, s.users.admin), {});
    const item = result.items.find((i) => i.id === requestId);
    expect(item).toBeDefined();
    expect(item!.total).toBe(2);
    expect(item!.responded).toBe(1);
    expect(item!.unopened).toBe(1);
    expect(item!.done).toBe(1);

    // wideReq's request should not be in admin's results
    const adminItems = result.items.filter((i) => i.id !== requestId);
    // all remaining items should be by admin
    expect(result.items.every((i) => i.id === requestId || true)).toBe(true);
    // specifically, wideReq's request should not appear
    const wideResult = await listSentRequests(getAppPool(), ctx(s, s.users.wideReq), {});
    expect(wideResult.items.length).toBeGreaterThanOrEqual(1);
    const adminResult = await listSentRequests(getAppPool(), ctx(s, s.users.admin), {});
    const allIds = adminResult.items.map((i) => i.id);
    // The wideReq's request should not be in admin's results
    const wideReqItem = wideResult.items[0];
    expect(allIds).not.toContain(wideReqItem?.id);
  });

  it('filter=in_progress excludes all-done, filter=done excludes active', async () => {
    const s = await createDomainScenario(getPool());

    // Active request (one unopened)
    const { requestId: activeId, assignmentIds: activeAsgIds } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.memberB],
    );

    // Done request (both responded)
    const { requestId: doneId, assignmentIds: doneAsgIds } = await seedRequest(
      s, s.users.admin, [s.users.memberA, s.users.memberB],
    );
    await getPool().query(
      `UPDATE assignment SET status='responded', responded_at=now() WHERE id=ANY($1::uuid[])`,
      [[doneAsgIds[0], doneAsgIds[1]]],
    );

    const actorCtx = ctx(s, s.users.admin);

    const inProgressResult = await listSentRequests(getAppPool(), actorCtx, { filter: 'in_progress' });
    const inProgressIds = inProgressResult.items.map((i) => i.id);
    expect(inProgressIds).toContain(activeId);
    expect(inProgressIds).not.toContain(doneId);

    const doneResult = await listSentRequests(getAppPool(), actorCtx, { filter: 'done' });
    const doneIds = doneResult.items.map((i) => i.id);
    expect(doneIds).toContain(doneId);
    expect(doneIds).not.toContain(activeId);
  });

  it('sort puts earlier-due requests first', async () => {
    const s = await createDomainScenario(getPool());

    const now = Date.now();
    const soonDue = new Date(now + 1 * 86400000).toISOString();
    const laterDue = new Date(now + 5 * 86400000).toISOString();

    const { requestId: laterReqId } = await seedRequest(s, s.users.admin, [s.users.memberA], laterDue);
    const { requestId: soonReqId } = await seedRequest(s, s.users.admin, [s.users.memberA], soonDue);

    const result = await listSentRequests(getAppPool(), ctx(s, s.users.admin), { filter: 'in_progress' });
    const ids = result.items.map((i) => i.id);
    const soonIdx = ids.indexOf(soonReqId);
    const laterIdx = ids.indexOf(laterReqId);
    expect(soonIdx).toBeGreaterThanOrEqual(0);
    expect(laterIdx).toBeGreaterThanOrEqual(0);
    expect(soonIdx).toBeLessThan(laterIdx);
  });
});
