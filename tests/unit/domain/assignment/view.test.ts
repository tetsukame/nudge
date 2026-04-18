import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { markViewed, hasUnreadComments } from '../../../../src/domain/assignment/view.js';
import { createComment } from '../../../../src/domain/comment/create.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

async function seedAssignment(
  s: Awaited<ReturnType<typeof createDomainScenario>>,
  userId: string,
): Promise<{ requestId: string; assignmentId: string }> {
  const requestId = randomUUID();
  await getPool().query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1, $2, $3, 'task', 'view-test', 'active')`,
    [requestId, s.tenantId, s.users.admin],
  );
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO assignment(tenant_id, request_id, user_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [s.tenantId, requestId, userId],
  );
  return { requestId, assignmentId: rows[0].id };
}

describe('markViewed + hasUnreadComments', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('markViewed sets last_viewed_at', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    const memberACtx = ctx(s.tenantId, s.users.memberA);

    // Before markViewed, last_viewed_at should be null
    const { rows: before } = await getPool().query(
      `SELECT last_viewed_at FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(before[0].last_viewed_at).toBeNull();

    await markViewed(getAppPool(), memberACtx, assignmentId);

    const { rows: after } = await getPool().query(
      `SELECT last_viewed_at FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(after[0].last_viewed_at).not.toBeNull();
    expect(after[0].last_viewed_at).toBeInstanceOf(Date);
  });

  it('hasUnreadComments returns false before comment, true after comment added', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentId } = await seedAssignment(s, s.users.memberA);
    const memberACtx = ctx(s.tenantId, s.users.memberA);
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });

    // Mark viewed so last_viewed_at is set to now
    await markViewed(getAppPool(), memberACtx, assignmentId);

    // No comments yet → false
    const before = await hasUnreadComments(getAppPool(), memberACtx, assignmentId);
    expect(before).toBe(false);

    // Add a small delay to ensure created_at > last_viewed_at
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Post a broadcast comment as admin (requester)
    await createComment(getAppPool(), adminCtx, {
      requestId,
      assignmentId: null,
      body: 'Broadcast message',
    });

    // Now there's an unread comment → true
    const after = await hasUnreadComments(getAppPool(), memberACtx, assignmentId);
    expect(after).toBe(true);
  });
});
