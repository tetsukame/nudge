import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST, GET } from '../../app/t/[code]/api/requests/route.js';

describe('GET /t/:code/api/requests?scope=sent', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns requests created by actor with progress data', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    await POST(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'SentTest', type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [
            { type: 'user', userId: s.users.memberA },
            { type: 'user', userId: s.users.memberB },
          ],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );

    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests?scope=sent`, {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    const item = body.items.find((i: { title: string }) => i.title === 'SentTest');
    expect(item).toBeDefined();
    expect(item.total).toBe(2);
    expect(item.unopened).toBe(2);
  });
});
