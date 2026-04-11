import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertIndexExists, assertTableExists } from '../helpers/schema-assertions.js';

describe('notification', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, requestId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-ntf', 'T', 'r', 'https://kc/r') RETURNING id`,
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

  it('exists', async () => { await assertTableExists(pool, 'notification'); });

  it('has a partial index for pending worker lookup', async () => {
    await assertIndexExists(pool, 'notification', '%pending%');
  });

  it('accepts valid statuses', async () => {
    for (const st of ['pending','sent','failed','skipped']) {
      await pool.query(
        `INSERT INTO notification (tenant_id, request_id, recipient_user_id, channel, kind, scheduled_at, status)
         VALUES ($1,$2,$3,'email','created',now(),$4)`,
        [tenantId, requestId, userId, st],
      );
    }
  });

  it('rejects invalid status', async () => {
    await expect(
      pool.query(
        `INSERT INTO notification (tenant_id, request_id, recipient_user_id, channel, kind, scheduled_at, status)
         VALUES ($1,$2,$3,'email','created',now(),'queued')`,
        [tenantId, requestId, userId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
