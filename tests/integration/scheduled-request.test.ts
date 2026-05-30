import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { runScheduler } from '../../src/worker/scheduler.js';

describe('NDG-70: scheduled send', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  async function createScheduled(
    s: Awaited<ReturnType<typeof createDomainScenario>>,
    creatorId: string,
    assigneeId: string,
    scheduledAt: string,
  ): Promise<string> {
    const cookie = await makeSessionCookie({
      userId: creatorId, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          title: 'Scheduled-test',
          dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          targets: [{ type: 'user', userId: assigneeId }],
          scheduledAt,
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

  it('future scheduledAt creates draft request without notifications', async () => {
    const s = await createDomainScenario(getPool());
    const future = new Date(Date.now() + 86400000).toISOString();
    const id = await createScheduled(s, s.users.wideReq, s.users.memberA, future);

    const { rows: r } = await getPool().query(
      `SELECT status, scheduled_at FROM request WHERE id=$1`, [id],
    );
    expect(r[0].status).toBe('draft');
    expect(r[0].scheduled_at).not.toBeNull();

    // No 'created' notifications yet
    const { rows: n } = await getPool().query(
      `SELECT 1 FROM notification WHERE request_id=$1 AND kind='created'`, [id],
    );
    expect(n.length).toBe(0);

    // Assignment IS created (so requester can preview recipients)
    const { rows: a } = await getPool().query(
      `SELECT 1 FROM assignment WHERE request_id=$1`, [id],
    );
    expect(a.length).toBe(1);
  });

  it('past scheduledAt falls through to immediate active send', async () => {
    const s = await createDomainScenario(getPool());
    const past = new Date(Date.now() - 1000).toISOString();
    const id = await createScheduled(s, s.users.wideReq, s.users.memberA, past);

    const { rows: r } = await getPool().query(
      `SELECT status, scheduled_at FROM request WHERE id=$1`, [id],
    );
    expect(r[0].status).toBe('active');
    expect(r[0].scheduled_at).toBeNull();

    const { rows: n } = await getPool().query(
      `SELECT 1 FROM notification WHERE request_id=$1 AND kind='created'`, [id],
    );
    expect(n.length).toBeGreaterThan(0);
  });

  it('worker activates due draft and emits created notifications + audit log', async () => {
    const s = await createDomainScenario(getPool());
    const future = new Date(Date.now() + 86400000).toISOString();
    const id = await createScheduled(s, s.users.wideReq, s.users.memberA, future);

    // Force scheduled_at into the past to simulate "due" without waiting a day
    await getPool().query(
      `UPDATE request SET scheduled_at = now() - interval '1 minute' WHERE id=$1`, [id],
    );

    await runScheduler(getPool());

    const { rows: r } = await getPool().query(
      `SELECT status FROM request WHERE id=$1`, [id],
    );
    expect(r[0].status).toBe('active');

    const { rows: n } = await getPool().query(
      `SELECT recipient_user_id FROM notification WHERE request_id=$1 AND kind='created'`,
      [id],
    );
    expect(n.some((row) => row.recipient_user_id === s.users.memberA)).toBe(true);

    const { rows: audit } = await getPool().query(
      `SELECT action FROM audit_log WHERE target_id=$1 AND action='request.activated_scheduled'`,
      [id],
    );
    expect(audit.length).toBe(1);
  });
});
