import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST } from '../../app/t/[code]/api/requests/route.js';

describe('POST /t/:code/api/requests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creates a request and returns 201', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const req = new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Integration R',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: s.users.memberA }],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: s.tenantCode }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.expandedCount).toBe(1);

    const { rows } = await getPool().query(
      `SELECT title FROM request WHERE id=$1`,
      [body.id],
    );
    expect(rows[0].title).toBe('Integration R');
  });
});
