import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('user_role', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-role', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'r', 'r@x', 'R') RETURNING id`, [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'user_role'); });

  it('accepts valid roles', async () => {
    await pool.query(
      `INSERT INTO user_role (tenant_id, user_id, role) VALUES ($1,$2,'tenant_admin')`,
      [tenantId, userId],
    );
    await pool.query(
      `INSERT INTO user_role (tenant_id, user_id, role) VALUES ($1,$2,'tenant_wide_requester')`,
      [tenantId, userId],
    );
  });

  it('rejects invalid role', async () => {
    await expect(
      pool.query(
        `INSERT INTO user_role (tenant_id, user_id, role) VALUES ($1,$2,'god')`,
        [tenantId, userId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
