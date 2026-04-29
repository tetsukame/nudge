import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST, GET } from '../../app/t/[code]/api/requests/route.js';

describe('GET /t/:code/api/requests?scope=...', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('mine returns only requests for the assignee', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    await POST(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Mine',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests?scope=mine`, {
        method: 'GET',
        headers: { cookie: memberCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { title: string }) => i.title)).toContain('Mine');
  });

  it('scope=all without wide_requester → 403', async () => {
    const s = await createDomainScenario(getPool());
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests?scope=all`, {
        method: 'GET',
        headers: { cookie: memberCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(403);
  });
});
