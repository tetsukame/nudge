import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { GET } from '../../app/t/[code]/api/admin/audit/route.js';
import { PUT as rolesPUT } from '../../app/t/[code]/api/admin/users/[id]/roles/route.js';

describe('NDG-67: audit log access for auditor role', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('outsider (no role) is rejected with 403', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/audit`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(403);
  });

  it('tenant_admin can view audit log', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/audit`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(Array.isArray(data.targetTypes)).toBe(true);
  });

  it('auditor (non-admin) can view audit log; assignment recorded in log', async () => {
    const s = await createDomainScenario(getPool());

    // tenant_admin assigns 'auditor' role to memberA
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const assignRes = await rolesPUT(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/roles`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ roles: ['auditor'] }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    expect(assignRes.status).toBe(200);

    // memberA (now auditor) can read the audit log
    const auditorCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/audit`,
        { headers: { cookie: auditorCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // The role-assignment event itself should appear in the log
    const roleEvents = (data.items as Array<{ action: string }>).filter(
      (i) => i.action === 'admin.user.roles_changed',
    );
    expect(roleEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('CSV export returns CSV with proper headers', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/audit?format=csv`,
        { headers: { cookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');
    const text = await res.text();
    expect(text.split('\n')[0]).toBe(
      'created_at,actor_user_id,actor_name,action,target_type,target_id,payload_json',
    );
  });

  it('targetType filter narrows results', async () => {
    const s = await createDomainScenario(getPool());

    // Seed an audit event via role assignment
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    await rolesPUT(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/roles`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ roles: ['manager'] }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );

    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/audit?targetType=user`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect((data.items as Array<{ targetType: string }>).every((i) => i.targetType === 'user')).toBe(true);
  });
});
