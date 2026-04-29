import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { createComment, CommentError } from '../../../../src/domain/comment/create.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('createComment', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('broadcast by requester succeeds (assignment_id=null in DB)', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });

    const req = await createRequest(getAppPool(), adminCtx, {
      title: 'Broadcast test',
      body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      targets: [{ type: 'user', userId: s.users.memberA }],
    });

    const result = await createComment(getAppPool(), adminCtx, {
      requestId: req.id,
      assignmentId: null,
      body: 'Hello everyone',
    });

    expect(result.id).toBeTruthy();
    expect(result.createdAt).toBeInstanceOf(Date);

    const { rows } = await getPool().query(
      `SELECT assignment_id FROM request_comment WHERE id = $1`,
      [result.id],
    );
    expect(rows[0].assignment_id).toBeNull();
  });

  it('individual comment by assignee succeeds', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const memberACtx = ctx(s.tenantId, s.users.memberA);

    const req = await createRequest(getAppPool(), adminCtx, {
      title: 'Individual test',
      body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      targets: [{ type: 'user', userId: s.users.memberA }],
    });

    // Get memberA's assignment
    const { rows: asgRows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id = $1 AND user_id = $2`,
      [req.id, s.users.memberA],
    );
    const assignmentId = asgRows[0].id;

    const result = await createComment(getAppPool(), memberACtx, {
      requestId: req.id,
      assignmentId,
      body: 'My reply',
    });

    expect(result.id).toBeTruthy();

    const { rows } = await getPool().query(
      `SELECT assignment_id, author_user_id FROM request_comment WHERE id = $1`,
      [result.id],
    );
    expect(rows[0].assignment_id).toBe(assignmentId);
    expect(rows[0].author_user_id).toBe(s.users.memberA);
  });

  it('broadcast by non-requester fails with CommentError', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const memberACtx = ctx(s.tenantId, s.users.memberA);

    const req = await createRequest(getAppPool(), adminCtx, {
      title: 'Permission test',
      body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      targets: [{ type: 'user', userId: s.users.memberA }],
    });

    await expect(
      createComment(getAppPool(), memberACtx, {
        requestId: req.id,
        assignmentId: null,
        body: 'Not allowed',
      }),
    ).rejects.toBeInstanceOf(CommentError);
  });
});
