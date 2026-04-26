import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startTestDb,
  stopTestDb,
  getPool,
} from '../../helpers/pg-container.js';
import { createDomainScenario } from '../../helpers/fixtures/domain-scenario.js';
import { runSender } from '../../../src/worker/sender.js';
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

async function seedRequest(scenario: DomainScenario): Promise<string> {
  const pool = getPool();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1, $2, $3, 'task', 'Test Request', 'active')`,
    [id, scenario.tenantId, scenario.users.admin],
  );
  return id;
}

async function seedNotification(
  tenantId: string,
  requestId: string,
  recipientUserId: string,
  channel: string,
  kind = 'created',
  status = 'pending',
): Promise<string> {
  const pool = getPool();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO notification(id, tenant_id, request_id, recipient_user_id,
                              channel, kind, scheduled_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, now() - interval '1 second', $7)`,
    [id, tenantId, requestId, recipientUserId, channel, kind, status],
  );
  return id;
}

describe('runSender', () => {
  it('marks pending in_app notification as sent', async () => {
    const requestId = await seedRequest(s);
    const notifId = await seedNotification(
      s.tenantId,
      requestId,
      s.users.memberA,
      'in_app',
    );

    await runSender(getPool());

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT status, sent_at FROM notification WHERE id = $1`,
      [notifId],
    );
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('marks email notification failed when SMTP not configured', async () => {
    // No tenant_settings row → DEFAULT_SETTINGS → smtpHost=null → ChannelError
    const requestId = await seedRequest(s);
    const notifId = await seedNotification(
      s.tenantId,
      requestId,
      s.users.memberA,
      'email',
    );

    await runSender(getPool());

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT status, attempt_count, error_message FROM notification WHERE id = $1`,
      [notifId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempt_count).toBe(1);
    expect(rows[0].error_message).toContain('SMTP host not configured');
  });

  it('skips already-sent notifications (no double-processing)', async () => {
    const requestId = await seedRequest(s);
    const notifId = await seedNotification(
      s.tenantId,
      requestId,
      s.users.memberA,
      'in_app',
      'created',
      'sent',
    );

    await runSender(getPool());

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT status, attempt_count FROM notification WHERE id = $1`,
      [notifId],
    );
    // Still sent, attempt_count unchanged (was 0)
    expect(rows[0].status).toBe('sent');
    expect(rows[0].attempt_count).toBe(0);
  });

  it('marks failed for unknown channel type', async () => {
    const requestId = await seedRequest(s);
    // 'teams' is a valid channel value in the DB CHECK constraint
    const notifId = await seedNotification(
      s.tenantId,
      requestId,
      s.users.memberA,
      'teams',
    );

    await runSender(getPool());

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT status, error_message FROM notification WHERE id = $1`,
      [notifId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error_message).toContain('unknown channel');
  });
});
