import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { GET as matrixGet } from '../../app/t/[code]/api/subordinates/matrix/route.js';
import { POST as remindAssignmentPost } from '../../app/t/[code]/api/assignments/[id]/remind/route.js';

describe('subordinate matrix + per-assignment remind (NDG-42)', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('matrix returns users / requests / cells for the manager subtree', async () => {
    const s = await createDomainScenario(getPool());

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const managerCookie = await makeSessionCookie({
      userId: s.users.manager, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Two requests targeting the team users (both are subordinates of manager).
    for (const title of ['Task A', 'Task B']) {
      const r = await createReq(
        new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            title,
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            targets: [
              { type: 'user', userId: s.users.memberA },
              { type: 'user', userId: s.users.memberB },
            ],
          }),
        }),
        { params: Promise.resolve({ code: s.tenantCode }) },
      );
      expect(r.status).toBe(201);
    }

    const res = await matrixGet(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/subordinates/matrix?filter=in_progress`,
        { headers: { cookie: managerCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.users).toHaveLength(2);
    expect(data.requests).toHaveLength(2);
    // 2 requests × 2 users = 4 cells
    expect(data.cells).toHaveLength(4);

    const userIds = data.users.map((u: { userId: string }) => u.userId).sort();
    expect(userIds).toEqual([s.users.memberA, s.users.memberB].sort());
    // The manager themself must NOT appear in their own subordinates list.
    expect(userIds).not.toContain(s.users.manager);

    // pendingCount and counts wired correctly
    for (const u of data.users) expect(u.pendingCount).toBe(2);
    for (const r of data.requests) expect(r.pendingCount).toBe(2);

    // subtree totals are computed independent of the in_progress filter
    for (const r of data.requests) {
      expect(r.subtreeTotal).toBe(2);
      expect(r.subtreeDone).toBe(0);
    }

    // After resolving one assignment, subtree_done should reflect it on the next call
    const reqAId = data.requests[0].requestId;
    await getPool().query(
      `UPDATE assignment SET status='responded', action_at=now()
        WHERE request_id=$1 AND user_id=$2`,
      [reqAId, s.users.memberA],
    );
    const res2 = await matrixGet(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/subordinates/matrix?filter=in_progress`,
        { headers: { cookie: managerCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const data2 = await res2.json();
    const req2 = data2.requests.find(
      (r: { requestId: string }) => r.requestId === reqAId,
    );
    expect(req2.subtreeTotal).toBe(2);
    expect(req2.subtreeDone).toBe(1);
  });

  it('per-assignment remind allows manager → 200 + audit + rate limited', async () => {
    const s = await createDomainScenario(getPool());

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const managerCookie = await makeSessionCookie({
      userId: s.users.manager, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const outsiderCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Cell remind',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();

    const { rows: asgRows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [requestId, s.users.memberA],
    );
    const assignmentId = asgRows[0].id;

    // outsider (no manager rel to memberA) → 403
    const denied = await remindAssignmentPost(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}/remind`,
        { method: 'POST', headers: { cookie: outsiderCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(denied.status).toBe(403);

    // manager (org_unit_manager of orgDiv → ancestor of orgTeam) → 200
    const ok = await remindAssignmentPost(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}/remind`,
        { method: 'POST', headers: { cookie: managerCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.recipientUserId).toBe(s.users.memberA);

    // Notification + audit row
    const { rows: notif } = await getPool().query(
      `SELECT 1 FROM notification
        WHERE assignment_id = $1 AND kind = 're_notify'`,
      [assignmentId],
    );
    expect(notif.length).toBeGreaterThanOrEqual(1);
    const { rows: audit } = await getPool().query(
      `SELECT 1 FROM audit_log
        WHERE action = 'assignment.manual_remind' AND target_id = $1`,
      [assignmentId],
    );
    expect(audit.length).toBe(1);

    // Second call → 429
    const rl = await remindAssignmentPost(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}/remind`,
        { method: 'POST', headers: { cookie: managerCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(rl.status).toBe(429);
  });

  it('returns 400 not_pending if the assignment is already resolved', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'already-resolved',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();
    const { rows: asgRows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = asgRows[0].id;

    await getPool().query(
      `UPDATE assignment SET status='responded', action_at=now() WHERE id=$1`,
      [assignmentId],
    );

    const res = await remindAssignmentPost(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}/remind`,
        { method: 'POST', headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('not_pending');
  });
});
