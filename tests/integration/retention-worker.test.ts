import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { runRetention, _resetRetentionScheduler } from '../../src/worker/retention.js';
import { upsertRetentionConfig } from '../../src/domain/retention/config.js';
import type { ActorContext } from '../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin,
    tenantId: s.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  };
}

async function seedExpiredNotification(
  tenantId: string,
  recipientUserId: string,
  daysOld: number,
  status: 'sent' | 'failed' | 'pending' = 'sent',
): Promise<string> {
  const pool = getPool();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO notification
       (id, tenant_id, recipient_user_id, channel, kind, status, scheduled_at, created_at, payload_json)
     VALUES ($1, $2, $3, 'email', 'created', $4,
             now() - make_interval(days => $5), now() - make_interval(days => $5),
             '{}'::jsonb)`,
    [id, tenantId, recipientUserId, status, daysOld],
  );
  return id;
}

async function seedExpiredAuditLog(
  tenantId: string,
  actorUserId: string,
  daysOld: number,
): Promise<void> {
  await getPool().query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, target_type, target_id, payload_json, created_at)
     VALUES ($1, $2, 'test.action', 'request', $3, '{}'::jsonb,
             now() - make_interval(days => $4))`,
    [tenantId, actorUserId, randomUUID(), daysOld],
  );
}

describe('NDG-89: retention worker', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => { _resetRetentionScheduler(); });

  it('no-op when no tenant has retention enabled', async () => {
    const s = await createDomainScenario(getPool());
    await seedExpiredNotification(s.tenantId, s.users.memberA, 200);
    await runRetention(getPool(), true);
    const { rows } = await getPool().query(
      `SELECT archived_at FROM notification WHERE tenant_id=$1`, [s.tenantId],
    );
    // not archived because retention is disabled
    expect(rows[0].archived_at).toBeNull();
  });

  it('soft-archives notifications older than tenant retention period', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, notificationDays: 30,
    });
    const oldId = await seedExpiredNotification(s.tenantId, s.users.memberA, 60);
    const newId = await seedExpiredNotification(s.tenantId, s.users.memberA, 10);

    await runRetention(getPool(), true);

    const { rows } = await getPool().query<{ id: string; archived_at: Date | null }>(
      `SELECT id, archived_at FROM notification WHERE id IN ($1, $2)`,
      [oldId, newId],
    );
    const oldRow = rows.find((r) => r.id === oldId)!;
    const newRow = rows.find((r) => r.id === newId)!;
    expect(oldRow.archived_at).not.toBeNull();
    expect(newRow.archived_at).toBeNull();
  });

  it('does not archive pending notifications (only sent/failed/skipped)', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, notificationDays: 30,
    });
    const pendingId = await seedExpiredNotification(s.tenantId, s.users.memberA, 60, 'pending');
    await runRetention(getPool(), true);
    const { rows } = await getPool().query(
      `SELECT archived_at FROM notification WHERE id=$1`, [pendingId],
    );
    expect(rows[0].archived_at).toBeNull();
  });

  it('soft-archives audit_log older than tenant retention period', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, auditLogDays: 365,
    });
    await seedExpiredAuditLog(s.tenantId, s.users.admin, 400);
    await seedExpiredAuditLog(s.tenantId, s.users.admin, 100);

    await runRetention(getPool(), true);

    const { rows: archived } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM audit_log
        WHERE tenant_id=$1 AND archived_at IS NOT NULL`,
      [s.tenantId],
    );
    expect(archived[0].n).toBe(1);
  });

  it('hard-deletes only when hard_delete_enabled=true and after grace period', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, hardDeleteEnabled: true,
      notificationDays: 30, softDeleteGraceDays: 7,
    });
    const id = await seedExpiredNotification(s.tenantId, s.users.memberA, 60);

    // First run: soft archive
    await runRetention(getPool(), true);
    {
      const { rows } = await getPool().query(
        `SELECT archived_at FROM notification WHERE id=$1`, [id],
      );
      expect(rows[0].archived_at).not.toBeNull();
    }

    // Force the archived_at to be older than grace, simulating waiting > 7 days
    await getPool().query(
      `UPDATE notification SET archived_at = now() - make_interval(days => 10) WHERE id=$1`,
      [id],
    );

    // Second run: hard delete
    await runRetention(getPool(), true);
    {
      const { rows } = await getPool().query(
        `SELECT id FROM notification WHERE id=$1`, [id],
      );
      expect(rows.length).toBe(0);
    }
  });

  it('hard delete is skipped when hard_delete_enabled=false even after grace', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, hardDeleteEnabled: false,
      notificationDays: 30, softDeleteGraceDays: 7,
    });
    const id = await seedExpiredNotification(s.tenantId, s.users.memberA, 60);
    await runRetention(getPool(), true);
    await getPool().query(
      `UPDATE notification SET archived_at = now() - make_interval(days => 30) WHERE id=$1`,
      [id],
    );
    await runRetention(getPool(), true);
    const { rows } = await getPool().query(
      `SELECT id FROM notification WHERE id=$1`, [id],
    );
    expect(rows.length).toBe(1); // still present
  });

  it('writes retention_log rows reflecting soft/hard actions', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, notificationDays: 30,
    });
    await seedExpiredNotification(s.tenantId, s.users.memberA, 60);
    await seedExpiredNotification(s.tenantId, s.users.memberA, 70);

    await runRetention(getPool(), true);

    const { rows } = await getPool().query<{
      action: string; rows_affected: number; table_name: string;
    }>(
      `SELECT action, rows_affected, table_name FROM retention_log
        WHERE tenant_id=$1 AND table_name='notification'`,
      [s.tenantId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe('soft');
    expect(rows[0].rows_affected).toBe(2);
  });

  it('respects 1h interval and skips repeated calls within the window', async () => {
    const s = await createDomainScenario(getPool());
    await upsertRetentionConfig(getPool(), adminCtx(s), {
      enabled: true, notificationDays: 30,
    });
    await seedExpiredNotification(s.tenantId, s.users.memberA, 60);
    await runRetention(getPool(), true); // primes lastRetentionRunAt
    // Now seed another expired item and call without force
    await seedExpiredNotification(s.tenantId, s.users.memberA, 70);
    await runRetention(getPool()); // should be no-op
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification
        WHERE tenant_id=$1 AND archived_at IS NULL
          AND status IN ('sent','failed','skipped')`,
      [s.tenantId],
    );
    expect(rows[0].n).toBe(1); // the second seed is untouched
  });
});
