import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn, assertTableExists } from '../helpers/schema-assertions.js';

describe('users table', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    const res = await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-users', 'T', 'r', 'https://kc/realms/r') RETURNING id`,
    );
    tenantId = res.rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists with required columns', async () => {
    await assertTableExists(pool, 'users');
    await assertColumn(pool, 'users', 'id', 'uuid', false);
    await assertColumn(pool, 'users', 'tenant_id', 'uuid', false);
    await assertColumn(pool, 'users', 'keycloak_sub', 'text', false);
    await assertColumn(pool, 'users', 'email', 'text', false);
    await assertColumn(pool, 'users', 'display_name', 'text', false);
    await assertColumn(pool, 'users', 'status', 'text', false);
  });

  it('enforces UNIQUE(tenant_id, keycloak_sub)', async () => {
    await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'sub-1', 'a@x', 'A')`,
      [tenantId],
    );
    await expect(
      pool.query(
        `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
         VALUES ($1, 'sub-1', 'b@x', 'B')`,
        [tenantId],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('rejects invalid status', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
         VALUES ($1, 'sub-x', 'x@x', 'X', 'banned')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
