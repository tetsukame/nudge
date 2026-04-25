import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { GET } from '../../app/t/[code]/api/requests/[id]/assignees/route.js';

describe('GET /t/:code/api/requests/:id/assignees', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester sees all assignees with summary', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Create a request targeting memberA + memberB
    const createRes = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'AssigneesTest',
          type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [
            { type: 'user', userId: s.users.memberA },
            { type: 'user', userId: s.users.memberB },
          ],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(createRes.status).toBe(201);
    const { id: requestId } = await createRes.json();

    // GET assignees as requester (admin)
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/assignees`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.summary.unopened).toBe(2);
    expect(body.total).toBe(2);
  });

  it('outsider gets 403', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const outsiderCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Create a request targeting memberA
    const createRes = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'OutsiderTest',
          type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(createRes.status).toBe(201);
    const { id: requestId } = await createRes.json();

    // GET assignees as outsider → 403
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/assignees`,
        { headers: { cookie: outsiderCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(403);
  });
});
