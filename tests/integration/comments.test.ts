import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import {
  GET as getComments,
  POST as postComment,
} from '../../app/t/[code]/api/requests/[id]/comments/route.js';

describe('comments broadcast + individual round-trip', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('broadcast + individual thread round-trip', async () => {
    const s = await createDomainScenario(getPool());

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const memberACookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // 1. Create a request as admin targeting memberA
    const createReqObj = new NextRequest(
      `http://localhost/t/${s.tenantCode}/api/requests`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Comment Test',
          type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      },
    );
    const createRes = await createReq(createReqObj, {
      params: Promise.resolve({ code: s.tenantCode }),
    });
    expect(createRes.status).toBe(201);
    const { id: requestId } = await createRes.json();

    // Get assignment ID for memberA
    const { rows: asgRows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [requestId, s.users.memberA],
    );
    const assignmentId = asgRows[0].id;

    // 2. Post broadcast comment as admin (requester), assignmentId=null → 201
    const broadcastRes = await postComment(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ body: 'Hello everyone', assignmentId: null }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(broadcastRes.status).toBe(201);

    // 3. Post individual comment as memberA → 201
    const individualRes = await postComment(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: memberACookie },
          body: JSON.stringify({ body: 'My reply', assignmentId }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(individualRes.status).toBe(201);

    // 4. List as memberA: sees broadcasts + own thread, no allThreads
    const memberAListRes = await getComments(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/comments`,
        { headers: { cookie: memberACookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(memberAListRes.status).toBe(200);
    const memberAData = await memberAListRes.json();
    expect(memberAData.broadcasts).toHaveLength(1);
    expect(memberAData.broadcasts[0].body).toBe('Hello everyone');
    expect(memberAData.myThread).toHaveLength(1);
    expect(memberAData.myThread[0].body).toBe('My reply');
    expect(memberAData.allThreads).toBeUndefined();

    // 5. List as admin (requester): sees allThreads with memberA's assignment
    const adminListRes = await getComments(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/comments`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(adminListRes.status).toBe(200);
    const adminData = await adminListRes.json();
    expect(adminData.allThreads).toBeDefined();
    expect(adminData.allThreads[assignmentId]).toHaveLength(1);
    expect(adminData.allThreads[assignmentId][0].body).toBe('My reply');
  });
});
