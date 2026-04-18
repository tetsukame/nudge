import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { createComment } from '../../../../src/domain/comment/create.js';
import { listComments } from '../../../../src/domain/comment/list.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('listComments', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('assignee sees broadcasts + own thread, NOT other assignee thread, allThreads undefined', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const memberACtx = ctx(s.tenantId, s.users.memberA);
    const memberBCtx = ctx(s.tenantId, s.users.memberB);

    const req = await createRequest(getAppPool(), adminCtx, {
      title: 'Visibility test',
      body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
      ],
    });

    // Get assignments
    const { rows: asgRows } = await getPool().query(
      `SELECT id, user_id FROM assignment WHERE request_id = $1 ORDER BY user_id`,
      [req.id],
    );
    const asgA = asgRows.find((r) => r.user_id === s.users.memberA)!.id;
    const asgB = asgRows.find((r) => r.user_id === s.users.memberB)!.id;

    // Requester posts broadcast
    await createComment(getAppPool(), adminCtx, {
      requestId: req.id,
      assignmentId: null,
      body: 'Broadcast message',
    });

    // memberA posts in their thread
    await createComment(getAppPool(), memberACtx, {
      requestId: req.id,
      assignmentId: asgA,
      body: 'Reply from A',
    });

    // memberB posts in their thread
    await createComment(getAppPool(), memberBCtx, {
      requestId: req.id,
      assignmentId: asgB,
      body: 'Reply from B',
    });

    // memberA lists comments — should see broadcast + own thread, no allThreads
    const result = await listComments(getAppPool(), memberACtx, req.id);

    expect(result.broadcasts).toHaveLength(1);
    expect(result.broadcasts[0].body).toBe('Broadcast message');

    expect(result.myThread).toHaveLength(1);
    expect(result.myThread[0].body).toBe('Reply from A');

    // allThreads should be undefined for non-requester
    expect(result.allThreads).toBeUndefined();
  });

  it('requester sees broadcasts + allThreads with all individual threads', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const memberACtx = ctx(s.tenantId, s.users.memberA);
    const memberBCtx = ctx(s.tenantId, s.users.memberB);

    const req = await createRequest(getAppPool(), adminCtx, {
      title: 'Requester view test',
      body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
      ],
    });

    // Get assignments
    const { rows: asgRows } = await getPool().query(
      `SELECT id, user_id FROM assignment WHERE request_id = $1 ORDER BY user_id`,
      [req.id],
    );
    const asgA = asgRows.find((r) => r.user_id === s.users.memberA)!.id;
    const asgB = asgRows.find((r) => r.user_id === s.users.memberB)!.id;

    // Requester posts broadcast
    await createComment(getAppPool(), adminCtx, {
      requestId: req.id,
      assignmentId: null,
      body: 'Broadcast from requester',
    });

    // Assignees post in their threads
    await createComment(getAppPool(), memberACtx, {
      requestId: req.id,
      assignmentId: asgA,
      body: 'Thread A message',
    });
    await createComment(getAppPool(), memberBCtx, {
      requestId: req.id,
      assignmentId: asgB,
      body: 'Thread B message',
    });

    // Requester lists comments — should see broadcasts + allThreads
    const result = await listComments(getAppPool(), adminCtx, req.id);

    expect(result.broadcasts).toHaveLength(1);
    expect(result.broadcasts[0].body).toBe('Broadcast from requester');

    expect(result.allThreads).toBeDefined();
    expect(Object.keys(result.allThreads!)).toHaveLength(2);

    const threadA = result.allThreads![asgA];
    const threadB = result.allThreads![asgB];

    expect(threadA).toHaveLength(1);
    expect(threadA[0].body).toBe('Thread A message');

    expect(threadB).toHaveLength(1);
    expect(threadB[0].body).toBe('Thread B message');
  });
});
