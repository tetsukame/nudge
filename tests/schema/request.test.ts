import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('request', () => {
  let pool: pg.Pool;
  let tenantId: string, creator: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-req', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    creator = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'u', 'u@x', 'U') RETURNING id`, [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'request'); });

  it('accepts insert without a type column (NDG-7 dropped it)', async () => {
    await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, title, status)
       VALUES ($1, $2, 'T', 'active')`, [tenantId, creator],
    );
  });

  it('rejects invalid status', async () => {
    await expect(
      pool.query(
        `INSERT INTO request (tenant_id, created_by_user_id, title, status)
         VALUES ($1, $2, 'X', 'archived')`, [tenantId, creator],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
