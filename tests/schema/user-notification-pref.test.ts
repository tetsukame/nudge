import { afterAll, beforeAll, describe, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('user_notification_pref', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-unp', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'p', 'p@x', 'P') RETURNING id`, [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'user_notification_pref'); });

  it('stores per-channel preference', async () => {
    await pool.query(
      `INSERT INTO user_notification_pref (tenant_id, user_id, channel, enabled)
       VALUES ($1,$2,'email',false)`, [tenantId, userId],
    );
  });
});
