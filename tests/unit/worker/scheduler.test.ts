import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startTestDb,
  stopTestDb,
  getPool,
} from '../../helpers/pg-container.js';
import { createDomainScenario } from '../../helpers/fixtures/domain-scenario.js';
import { runScheduler } from '../../../src/worker/scheduler.js';
import type { DomainScenario } from '../../helpers/fixtures/domain-scenario.js';

let s: DomainScenario;

beforeAll(async () => {
  await startTestDb();
  s = await createDomainScenario(getPool());
});

afterAll(async () => {
  await stopTestDb();
});

beforeEach(() => {
  process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
});

/**
 * Insert a request with a given due_at offset (days from now) and an
 * assignment for memberA. Returns requestId and assignmentId.
 */
async function setupRequestWithDue(
  scenario: DomainScenario,
  daysFromNow: number,
): Promise<{ requestId: string; assignmentId: string }> {
  const pool = getPool();
  const requestId = randomUUID();
  const assignmentId = randomUUID();

  const dueExpr =
    daysFromNow >= 0
      ? `now() + interval '${daysFromNow} days'`
      : `now() - interval '${Math.abs(daysFromNow)} days'`;

  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, due_at, status)
     VALUES ($1, $2, $3, 'task', 'Sched Test', ${dueExpr}, 'active')`,
    [requestId, scenario.tenantId, scenario.users.admin],
  );
  await pool.query(
    `INSERT INTO assignment(id, tenant_id, request_id, user_id, status)
     VALUES ($1, $2, $3, $4, 'unopened')`,
    [assignmentId, scenario.tenantId, requestId, scenario.users.memberA],
  );

  return { requestId, assignmentId };
}

async function upsertTenantSettings(
  tenantId: string,
  {
    before = 1,
    interval = 3,
    max = 5,
  }: { before?: number; interval?: number; max?: number } = {},
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO tenant_settings(tenant_id, reminder_before_days, re_notify_interval_days, re_notify_max_count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE
       SET reminder_before_days    = EXCLUDED.reminder_before_days,
           re_notify_interval_days = EXCLUDED.re_notify_interval_days,
           re_notify_max_count     = EXCLUDED.re_notify_max_count,
           updated_at              = now()`,
    [tenantId, before, interval, max],
  );
}

async function countNotifications(
  assignmentId: string,
  kind: string,
): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM notification
      WHERE assignment_id = $1 AND kind = $2`,
    [assignmentId, kind],
  );
  return rows[0].cnt as number;
}

describe('runScheduler', () => {
  it('generates reminder_before for assignment due tomorrow', async () => {
    await upsertTenantSettings(s.tenantId, { before: 1 });
    const { assignmentId } = await setupRequestWithDue(s, 1); // due in 1 day

    await runScheduler(getPool());

    const cnt = await countNotifications(assignmentId, 'reminder_before');
    expect(cnt).toBeGreaterThan(0);
  });

  it('is idempotent — running twice does not create duplicate notifications', async () => {
    await upsertTenantSettings(s.tenantId, { before: 1 });
    const { assignmentId } = await setupRequestWithDue(s, 1);

    await runScheduler(getPool());
    const after1 = await countNotifications(assignmentId, 'reminder_before');

    await runScheduler(getPool());
    const after2 = await countNotifications(assignmentId, 'reminder_before');

    expect(after2).toBe(after1);
  });

  it('generates due_today for assignment due today', async () => {
    await upsertTenantSettings(s.tenantId);
    const { assignmentId } = await setupRequestWithDue(s, 0); // due today

    await runScheduler(getPool());

    const cnt = await countNotifications(assignmentId, 'due_today');
    expect(cnt).toBeGreaterThan(0);
  });

  it('generates re_notify when overdue and interval passed', async () => {
    // interval=0 so "last re_notify older than 0 days" is always true (or no prior)
    await upsertTenantSettings(s.tenantId, { interval: 0, max: 5 });
    const { assignmentId } = await setupRequestWithDue(s, -2); // due 2 days ago

    await runScheduler(getPool());

    const cnt = await countNotifications(assignmentId, 're_notify');
    expect(cnt).toBeGreaterThan(0);
  });

  it('respects re_notify_max_count — does not exceed max', async () => {
    await upsertTenantSettings(s.tenantId, { interval: 0, max: 2 });
    const { requestId, assignmentId } = await setupRequestWithDue(s, -3);

    // Pre-seed 2 sent re_notify rows (in_app channel)
    const pool = getPool();
    for (let i = 0; i < 2; i++) {
      await pool.query(
        `INSERT INTO notification(tenant_id, request_id, assignment_id, recipient_user_id,
                                  channel, kind, scheduled_at, status)
         VALUES ($1, $2, $3, $4, 'in_app', 're_notify',
                 now() - interval '1 hour', 'sent')`,
        [s.tenantId, requestId, assignmentId, s.users.memberA],
      );
    }

    await runScheduler(getPool());

    // Only count in_app rows (what max_count checks against)
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM notification
        WHERE assignment_id = $1 AND kind = 're_notify' AND channel = 'in_app'`,
      [assignmentId],
    );
    const total = rows[0].cnt as number;
    expect(total).toBe(2);
  });
});
