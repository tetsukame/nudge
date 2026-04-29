import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH } from '../../app/t/[code]/api/assignments/[id]/route.js';

describe('forward via REST', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('forwards to memberB, status=forwarded, new assignment created', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const aCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const createRes = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Fwd',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await createRes.json();
    const { rows: asg } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = asg[0].id;

    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: aCookie },
          body: JSON.stringify({ action: 'forward', toUserId: s.users.memberB, reason: 'busy' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(200);

    const { rows } = await getPool().query(
      `SELECT user_id, status, forwarded_from_assignment_id
         FROM assignment WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('forwarded');
    expect(rows[1].user_id).toBe(s.users.memberB);
    expect(rows[1].forwarded_from_assignment_id).toBe(assignmentId);
  });
});
