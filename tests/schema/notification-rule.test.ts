import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('notification_rule', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, requestId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-nr', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'n', 'n@x', 'N') RETURNING id`, [tenantId],
    )).rows[0].id;
    requestId = (await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, type, title)
       VALUES ($1,$2,'task','T') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'notification_rule'); });

  it('allows tenant default with request_id NULL', async () => {
    await pool.query(
      `INSERT INTO notification_rule (tenant_id, request_id, kind, offset_days)
       VALUES ($1, NULL, 'reminder_before', -3)`, [tenantId],
    );
  });

  it('allows per-request rule', async () => {
    await pool.query(
      `INSERT INTO notification_rule (tenant_id, request_id, kind, offset_days)
       VALUES ($1, $2, 'due_today', 0)`, [tenantId, requestId],
    );
  });

  it('rejects invalid kind', async () => {
    await expect(
      pool.query(
        `INSERT INTO notification_rule (tenant_id, kind, offset_days) VALUES ($1,'spam',0)`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
