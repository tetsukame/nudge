import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH } from '../../app/t/[code]/api/assignments/[id]/route.js';

describe('assignment status flow', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('unopened -> opened -> responded via REST', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const createReqObj = new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        title: 'Flow', type: 'task',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: s.users.memberA }],
      }),
    });
    const res = await createReq(createReqObj, { params: Promise.resolve({ code: s.tenantCode }) });
    expect(res.status).toBe(201);
    const { id: requestId } = await res.json();

    const { rows: asg } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = asg[0].id;

    const patch = (action: string, body: Record<string, unknown> = {}) =>
      PATCH(
        new NextRequest(
          `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', cookie: memberCookie },
            body: JSON.stringify({ action, ...body }),
          },
        ),
        { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
      );

    expect((await patch('open')).status).toBe(200);
    expect((await patch('respond', { note: 'done' })).status).toBe(200);

    const { rows } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('responded');
  });
});
