import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import {
  GET as getSettings,
  PUT as putSettings,
} from '../../app/t/[code]/api/admin/settings/notification/route.js';

describe('settings API', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('GET 403 for non-admin (memberA cookie)', async () => {
    const s = await createDomainScenario(getPool());
    const memberACookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const res = await getSettings(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/settings/notification`,
        { headers: { cookie: memberACookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(403);
  });

  it('GET as admin returns masked settings (smtp.hasPassword=false initially, channels object exists)', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const res = await getSettings(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/settings/notification`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.smtp.hasPassword).toBe(false);
    expect(body.channels).toBeDefined();
    expect(typeof body.channels.in_app).toBe('boolean');
    expect(typeof body.channels.email).toBe('boolean');
    expect(typeof body.channels.teams).toBe('boolean');
    expect(typeof body.channels.slack).toBe('boolean');
  });

  it('PUT updates + GET reflects changes (host, hasPassword, email, reminderBeforeDays)', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const putBody = {
      smtp: {
        host: 'smtp.api.test',
        port: 587,
        user: 'user@api.test',
        password: 'secret-pw',
        from: 'from@api.test',
        secure: false,
      },
      teams: {},
      slack: {},
      channels: { in_app: false, email: true, teams: false, slack: false },
      reminders: { reminderBeforeDays: 2, reNotifyIntervalDays: 3, reNotifyMaxCount: 5 },
    };

    const putRes = await putSettings(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/settings/notification`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify(putBody),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(putRes.status).toBe(200);
    const putJson = await putRes.json();
    expect(putJson.ok).toBe(true);

    const getRes = await getSettings(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/admin/settings/notification`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.smtp.host).toBe('smtp.api.test');
    expect(body.smtp.hasPassword).toBe(true);
    expect(body.channels.email).toBe(true);
    expect(body.reminders.reminderBeforeDays).toBe(2);
  });
});
