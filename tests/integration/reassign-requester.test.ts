import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH as reassignRoute } from '../../app/t/[code]/api/admin/requests/[id]/requester/route.js';
import { listSentRequests } from '../../src/domain/request/list-sent.js';

describe('NDG-41 retired requester detection + reassign', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('flags requests whose creator is inactive and reassigns to an active user', async () => {
    const s = await createDomainScenario(getPool());
    const wideCookie = await makeSessionCookie({
      userId: s.users.wideReq, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // wideReq creates a request, then is retired (status=inactive).
    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: wideCookie },
        body: JSON.stringify({
          title: '退職者の依頼',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();

    await getPool().query(
      `UPDATE users SET status='inactive' WHERE id=$1`,
      [s.users.wideReq],
    );

    // retiredRequesterOnly listing surfaces the request with createdByStatus inactive
    const listed = await listSentRequests(
      getPool(),
      {
        userId: s.users.admin,
        tenantId: s.tenantId,
        isTenantAdmin: true,
        isTenantWideRequester: false,
      },
      { tenantWide: true, retiredRequesterOnly: true, filter: 'all' },
    );
    const found = listed.items.find((i) => i.id === requestId);
    expect(found).toBeDefined();
    expect(found?.createdByStatus).toBe('inactive');
    expect(found?.createdByUserId).toBe(s.users.wideReq);

    // Admin reassigns to an active user (manager)
    const ok = await reassignRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/requests/${requestId}/requester`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ userId: s.users.manager }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.newUserId).toBe(s.users.manager);

    const { rows } = await getPool().query(
      `SELECT created_by_user_id FROM request WHERE id=$1`,
      [requestId],
    );
    expect(rows[0].created_by_user_id).toBe(s.users.manager);

    const { rows: audit } = await getPool().query(
      `SELECT 1 FROM audit_log
        WHERE action='request.requester_reassigned' AND target_id=$1`,
      [requestId],
    );
    expect(audit.length).toBe(1);

    // It should no longer appear under retiredRequesterOnly.
    const after = await listSentRequests(
      getPool(),
      {
        userId: s.users.admin,
        tenantId: s.tenantId,
        isTenantAdmin: true,
        isTenantWideRequester: false,
      },
      { tenantWide: true, retiredRequesterOnly: true, filter: 'all' },
    );
    expect(after.items.find((i) => i.id === requestId)).toBeUndefined();
  });

  it('rejects reassigning to an inactive user (422) and non-admin (403)', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'x',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();

    // memberB inactive → 422
    await getPool().query(
      `UPDATE users SET status='inactive' WHERE id=$1`,
      [s.users.memberB],
    );
    const inactive = await reassignRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/requests/${requestId}/requester`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ userId: s.users.memberB }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(inactive.status).toBe(422);

    // non-admin → 403
    const denied = await reassignRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/requests/${requestId}/requester`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: memberCookie },
          body: JSON.stringify({ userId: s.users.manager }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(denied.status).toBe(403);
  });
});
