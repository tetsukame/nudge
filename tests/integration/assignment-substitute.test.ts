import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH } from '../../app/t/[code]/api/assignments/[id]/route.js';

async function seedOne(tenantCode: string, adminId: string, memberA: string, tenantId: string) {
  const adminCookie = await makeSessionCookie({
    userId: adminId, tenantId, tenantCode,
  });
  const res = await createReq(
    new NextRequest(`http://localhost/t/${tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        title: 'Sub', type: 'task',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: memberA }],
      }),
    }),
    { params: Promise.resolve({ code: tenantCode }) },
  );
  return (await res.json()).id as string;
}

describe('substitute via REST', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester can substitute', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.admin, s.users.memberA, s.tenantId);
    const { rows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = rows[0].id;

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ action: 'substitute', reason: 'on behalf' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(200);
    const { rows: r2 } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(r2[0].status).toBe('substituted');
  });

  it('outsider rejected with 403', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.admin, s.users.memberA, s.tenantId);
    const { rows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = rows[0].id;

    const outsiderCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: outsiderCookie },
          body: JSON.stringify({ action: 'substitute', reason: 'x' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(403);
  });

  it('manager (not requester) can substitute assignee in managed subtree', async () => {
    const s = await createDomainScenario(getPool());
    // admin creates a request to memberA; manager is org_unit_manager of orgDiv
    // which contains orgTeam as descendant (memberA is in orgTeam).
    const requestId = await seedOne(s.tenantCode, s.users.admin, s.users.memberA, s.tenantId);
    const { rows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = rows[0].id;

    const managerCookie = await makeSessionCookie({
      userId: s.users.manager, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: managerCookie },
          body: JSON.stringify({ action: 'substitute', reason: 'manager override' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(200);

    const { rows: r } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(r[0].status).toBe('substituted');
  });
});
