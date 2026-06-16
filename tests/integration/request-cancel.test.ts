import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH as patchReq } from '../../app/t/[code]/api/requests/[id]/route.js';

async function seedOne(
  tenantCode: string, creatorId: string, assigneeId: string, tenantId: string,
): Promise<string> {
  const cookie = await makeSessionCookie({
    userId: creatorId, tenantId, tenantCode,
  });
  const res = await createReq(
    new NextRequest(`http://localhost/t/${tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Cancel-test',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: assigneeId }],
      }),
    }),
    { params: Promise.resolve({ code: tenantCode }) },
  );
  return (await res.json()).id as string;
}

describe('NDG-72: request cancel', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester can cancel; status→cancelled, notification queued, audit logged', async () => {
    const s = await createDomainScenario(getPool());
    // wideReq creates, memberA is the assignee
    const requestId = await seedOne(s.tenantCode, s.users.wideReq, s.users.memberA, s.tenantId);

    const cookie = await makeSessionCookie({
      userId: s.users.wideReq, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: 'no longer needed' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(200);

    const { rows: r } = await getPool().query(
      `SELECT status, cancelled_by_user_id, cancel_reason FROM request WHERE id=$1`,
      [requestId],
    );
    expect(r[0].status).toBe('cancelled');
    expect(r[0].cancelled_by_user_id).toBe(s.users.wideReq);
    expect(r[0].cancel_reason).toBe('no longer needed');

    const { rows: n } = await getPool().query(
      `SELECT recipient_user_id, kind FROM notification WHERE request_id=$1 AND kind='cancelled'`,
      [requestId],
    );
    // memberA should receive at least one notification row (one per enabled channel)
    expect(n.some((row) => row.recipient_user_id === s.users.memberA)).toBe(true);

    const { rows: a } = await getPool().query(
      `SELECT action, payload_json FROM audit_log WHERE target_id=$1 AND action='request.cancelled'`,
      [requestId],
    );
    expect(a.length).toBe(1);
    expect(a[0].payload_json.reason).toBe('no longer needed');
  });

  it('tenant_admin (non-requester) can cancel', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.wideReq, s.users.memberA, s.tenantId);

    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: 'admin override' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(200);
  });

  it('non-requester non-admin (manager) is rejected with 403', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.wideReq, s.users.memberA, s.tenantId);

    // manager is org_unit_manager of orgDiv but NOT requester / admin
    const cookie = await makeSessionCookie({
      userId: s.users.manager, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: 'x' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(403);
  });

  it('cannot cancel already-cancelled request (409)', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.wideReq, s.users.memberA, s.tenantId);

    const cookie = await makeSessionCookie({
      userId: s.users.wideReq, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    // First cancel succeeds
    const r1 = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: 'first' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(r1.status).toBe(200);

    // Second cancel rejected with 409 (invalid_state)
    const r2 = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: 'second' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(r2.status).toBe(409);
  });

  it('rejects empty reason with 400', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.wideReq, s.users.memberA, s.tenantId);

    const cookie = await makeSessionCookie({
      userId: s.users.wideReq, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: '  ' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(400);
  });

  // NDG-95 (S5): cancel reason 上限
  it('rejects cancel with reason longer than MAX_CANCEL_REASON', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.admin, s.users.memberA, s.tenantId);
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await patchReq(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie },
          body: JSON.stringify({ action: 'cancel', reason: 'x'.repeat(2001) }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation');
  });
});
