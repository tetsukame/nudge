import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import {
  GET as listManagedOrgsRoute,
  POST as addManagedOrgRoute,
} from '../../app/t/[code]/api/admin/users/[id]/managed-orgs/route.js';
import { DELETE as removeManagedOrgRoute } from '../../app/t/[code]/api/admin/users/[id]/managed-orgs/[orgUnitId]/route.js';
import { PUT as putRolesRoute } from '../../app/t/[code]/api/admin/users/[id]/roles/route.js';
import { PUT as putOrgUnitsRoute } from '../../app/t/[code]/api/admin/users/[id]/org-units/route.js';

describe('NDG-47 manager management API', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('add / remove managed orgs round-trips with admin auth', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Initially memberA has no managed orgs
    const list1 = await listManagedOrgsRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    expect(list1.status).toBe(200);
    expect((await list1.json()).items).toHaveLength(0);

    // Add 人事課 (orgSibling) — manager scope add
    const add = await addManagedOrgRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ orgUnitId: s.orgSibling }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    expect(add.status).toBe(200);

    const list2 = await listManagedOrgsRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    const items = (await list2.json()).items as Array<{ orgUnitId: string }>;
    expect(items.map((i) => i.orgUnitId)).toEqual([s.orgSibling]);

    // DELETE
    const del = await removeManagedOrgRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs/${s.orgSibling}`,
        { method: 'DELETE', headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({
        code: s.tenantCode, id: s.users.memberA, orgUnitId: s.orgSibling,
      }) },
    );
    expect(del.status).toBe(200);

    const list3 = await listManagedOrgsRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    expect((await list3.json()).items).toHaveLength(0);
  });

  it('toggling manager role auto-attaches / wipes the primary org', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Turn ON manager role for memberA → primary (orgTeam) should be auto-added
    const on = await putRolesRoute(
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
    expect(on.status).toBe(200);

    const { rows: rows1 } = await getPool().query(
      `SELECT org_unit_id FROM org_unit_manager WHERE user_id = $1`,
      [s.users.memberA],
    );
    expect(rows1.map((r) => r.org_unit_id)).toEqual([s.orgTeam]);

    // Add a manual second org while still manager
    await addManagedOrgRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ orgUnitId: s.orgSibling }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );

    // Turn OFF manager role → ALL managed orgs (including manual) should be wiped
    const off = await putRolesRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/roles`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ roles: [] }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    expect(off.status).toBe(200);

    const { rows: rows2 } = await getPool().query(
      `SELECT org_unit_id FROM org_unit_manager WHERE user_id = $1`,
      [s.users.memberA],
    );
    expect(rows2).toHaveLength(0);
  });

  it('changing primary org wipes managed orgs and re-attaches new primary if user is manager', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    // Set manager role for memberA → primary (orgTeam) auto-added
    await putRolesRoute(
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
    // Add manual org (orgSibling) too
    await addManagedOrgRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/managed-orgs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ orgUnitId: s.orgSibling }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );

    // Transfer: change primary from orgTeam → orgDiv
    const move = await putOrgUnitsRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberA}/org-units`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({
            orgUnitIds: [s.orgDiv],
            primaryOrgUnitId: s.orgDiv,
          }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberA }) },
    );
    expect(move.status).toBe(200);

    const { rows } = await getPool().query(
      `SELECT org_unit_id FROM org_unit_manager WHERE user_id = $1`,
      [s.users.memberA],
    );
    expect(rows.map((r) => r.org_unit_id)).toEqual([s.orgDiv]);

    // Audit row recorded
    const { rows: audit } = await getPool().query(
      `SELECT 1 FROM audit_log
        WHERE action = 'org_unit_manager.transferred' AND target_id = $1`,
      [s.users.memberA],
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it('non-admin cannot add a managed org (403)', async () => {
    const s = await createDomainScenario(getPool());
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await addManagedOrgRoute(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/users/${s.users.memberB}/managed-orgs`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: memberCookie },
          body: JSON.stringify({ orgUnitId: s.orgTeam }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: s.users.memberB }) },
    );
    expect(res.status).toBe(403);
  });
});
