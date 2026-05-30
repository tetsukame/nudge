import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { GET as listAdmin, POST as createTpl } from '../../app/t/[code]/api/admin/templates/route.js';
import { PUT as updateTpl, DELETE as archiveTpl } from '../../app/t/[code]/api/admin/templates/[id]/route.js';
import { GET as listForUser } from '../../app/t/[code]/api/templates/route.js';

describe('NDG-68: request templates', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  async function create(
    s: Awaited<ReturnType<typeof createDomainScenario>>,
    actorId: string,
    orgUnitId: string,
    title = 'My Template',
  ): Promise<string> {
    const cookie = await makeSessionCookie({
      userId: actorId, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await createTpl(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          orgUnitId,
          title,
          body: 'template body',
          estimatedMinutes: 30,
          defaultDueOffsetDays: 7,
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    if (res.status !== 201) {
      const t = await res.text();
      throw new Error(`create failed ${res.status}: ${t}`);
    }
    return (await res.json()).id as string;
  }

  it('member of owning org can create and edit; non-member cannot create', async () => {
    const s = await createDomainScenario(getPool());

    // manager is in orgDiv — can create a template for orgDiv
    const id = await create(s, s.users.manager, s.orgDiv, 'Div tpl');
    expect(typeof id).toBe('string');

    // outsider is in orgSibling — cannot create for orgDiv
    const outCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const denied = await createTpl(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/templates`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: outCookie },
        body: JSON.stringify({ orgUnitId: s.orgDiv, title: 'X' }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(denied.status).toBe(403);
  });

  it('tenant_admin can edit any template', async () => {
    const s = await createDomainScenario(getPool());
    const id = await create(s, s.users.manager, s.orgDiv, 'Div tpl');

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await updateTpl(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/templates/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          orgUnitId: s.orgDiv,
          title: 'Edited by admin',
          body: null,
          estimatedMinutes: null,
          defaultDueOffsetDays: null,
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode, id }) },
    );
    expect(res.status).toBe(200);
  });

  it('list (user-facing) returns only templates from actor’s org_units', async () => {
    const s = await createDomainScenario(getPool());
    // Create one in orgDiv (visible to manager / memberA via descendant?
    // No — uou rows are direct, not transitive — manager is in orgDiv only)
    await create(s, s.users.manager, s.orgDiv, 'For Div');
    // tenant_admin creates one in orgSibling (where outsider belongs)
    await create(s, s.users.admin, s.orgSibling, 'For Sibling');

    // outsider sees only the Sibling one
    const outCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const r = await listForUser(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/templates`, {
        headers: { cookie: outCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    const titles = (data.items as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toContain('For Sibling');
    expect(titles).not.toContain('For Div');
  });

  it('admin list returns all tenant templates', async () => {
    const s = await createDomainScenario(getPool());
    await create(s, s.users.manager, s.orgDiv, 'A');
    await create(s, s.users.admin, s.orgSibling, 'B');

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const r = await listAdmin(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/templates`, {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(r.status).toBe(200);
    const data = await r.json();
    const titles = (data.items as Array<{ title: string }>).map((t) => t.title);
    expect(titles).toContain('A');
    expect(titles).toContain('B');
  });

  it('archive (soft delete) removes from list', async () => {
    const s = await createDomainScenario(getPool());
    const id = await create(s, s.users.manager, s.orgDiv, 'ToArchive');

    const cookie = await makeSessionCookie({
      userId: s.users.manager, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const del = await archiveTpl(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/templates/${id}`, {
        method: 'DELETE', headers: { cookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode, id }) },
    );
    expect(del.status).toBe(200);

    const list = await listAdmin(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/templates`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const data = await list.json();
    expect((data.items as Array<{ id: string }>).find((t) => t.id === id)).toBeUndefined();
  });
});
