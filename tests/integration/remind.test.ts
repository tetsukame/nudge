import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { POST as remindReq } from '../../app/t/[code]/api/requests/[id]/remind/route.js';

describe('manual remind (NDG-40)', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester can fire remind, generates re_notify rows, then is rate-limited', async () => {
    const s = await createDomainScenario(getPool());

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const memberACookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Create a request as admin (requester), targeting memberA + memberB.
    const createRes = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Remind Test',
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

    // memberA (assignee, not requester) → 403 permission_denied
    const denied = await remindReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST', headers: { cookie: memberACookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(denied.status).toBe(403);

    // Requester (admin) succeeds → 200 + recipients = 2
    const ok = await remindReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST', headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.recipients).toBe(2);

    // re_notify rows created (one per recipient × enabled channels — at least 2)
    const { rows: notifRows } = await getPool().query(
      `SELECT recipient_user_id, kind FROM notification
        WHERE request_id = $1 AND kind = 're_notify'`,
      [requestId],
    );
    expect(notifRows.length).toBeGreaterThanOrEqual(2);
    const recipients = new Set(notifRows.map((r) => r.recipient_user_id));
    expect(recipients.has(s.users.memberA)).toBe(true);
    expect(recipients.has(s.users.memberB)).toBe(true);

    // Audit log entry
    const { rows: auditRows } = await getPool().query(
      `SELECT 1 FROM audit_log WHERE action = 'request.manual_remind' AND target_id = $1`,
      [requestId],
    );
    expect(auditRows.length).toBe(1);

    // Second call within an hour → 429 rate_limited
    const rl = await remindReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST', headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(rl.status).toBe(429);
    const rlBody = await rl.json();
    expect(rlBody.code).toBe('rate_limited');
  });

  it('returns 400 no_recipients when all assignments are already resolved', async () => {
    const s = await createDomainScenario(getPool());

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const createRes = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'No Recipients',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await createRes.json();

    // Mark the only assignee as responded directly.
    await getPool().query(
      `UPDATE assignment SET status='responded', action_at=now()
        WHERE request_id=$1`,
      [requestId],
    );

    const res = await remindReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/remind`,
        { method: 'POST', headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('no_recipients');
  });
});
