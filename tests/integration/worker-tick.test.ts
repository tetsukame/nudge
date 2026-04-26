import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { runScheduler } from '../../src/worker/scheduler';
import { runSender } from '../../src/worker/sender';

describe('worker tick (scheduler + sender)', () => {
  beforeAll(async () => {
    await startTestDb();
  });
  afterAll(async () => {
    await stopTestDb();
  });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
    vi.restoreAllMocks();
  });

  it('generates due_today reminder and delivers via in_app + email (mocked)', async () => {
    const s = await createDomainScenario(getPool());

    // Configure tenant: enable in_app + email
    for (const channel of ['in_app', 'email']) {
      await getPool().query(
        `INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, channel) DO UPDATE SET enabled = true`,
        [s.tenantId, channel],
      );
    }
    // Configure SMTP
    await getPool().query(
      `INSERT INTO tenant_settings(tenant_id, smtp_host, smtp_port, smtp_from, smtp_secure)
       VALUES ($1, 'smtp.example.com', 587, 'nudge@example.com', false)
       ON CONFLICT (tenant_id) DO UPDATE
          SET smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
              smtp_from = EXCLUDED.smtp_from, smtp_secure = EXCLUDED.smtp_secure`,
      [s.tenantId],
    );

    // Seed a request due today — set due_at to end-of-day so it satisfies
    // due_at::date = today but is NOT < now(), preventing re_notify from firing.
    const requestId = randomUUID();
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    await getPool().query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status, due_at)
       VALUES ($1, $2, $3, 'task', 'tick test', 'active', $4)`,
      [requestId, s.tenantId, s.users.admin, endOfToday.toISOString()],
    );
    await getPool().query(
      `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1, $2, $3)`,
      [s.tenantId, requestId, s.users.memberA],
    );

    // Mock nodemailer
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);

    // Run tick
    await runScheduler(getPool());
    await runSender(getPool());

    // Verify notifications
    const { rows: notifs } = await getPool().query(
      `SELECT channel, status FROM notification
        WHERE request_id=$1 AND kind='due_today' ORDER BY channel`,
      [requestId],
    );
    expect(notifs).toHaveLength(2);
    expect(notifs.map((r: { channel: string }) => r.channel).sort()).toEqual(['email', 'in_app']);
    expect(notifs.every((r: { status: string }) => r.status === 'sent')).toBe(true);

    // Verify nodemailer was called once for the email channel
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@test',
        subject: expect.stringContaining('本日が期限'),
      }),
    );
  });
});
