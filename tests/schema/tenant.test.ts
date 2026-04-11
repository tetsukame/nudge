import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn, assertConstraintExists, assertTableExists } from '../helpers/schema-assertions.js';

describe('tenant table', () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('exists with required columns', async () => {
    await assertTableExists(pool, 'tenant');
    await assertColumn(pool, 'tenant', 'id', 'uuid', false);
    await assertColumn(pool, 'tenant', 'code', 'text', false);
    await assertColumn(pool, 'tenant', 'name', 'text', false);
    await assertColumn(pool, 'tenant', 'keycloak_realm', 'text', false);
    await assertColumn(pool, 'tenant', 'keycloak_issuer_url', 'text', false);
    await assertColumn(pool, 'tenant', 'status', 'text', false);
    await assertColumn(pool, 'tenant', 'created_at', 'timestamp with time zone', false);
  });

  it('has PK, UNIQUE on code, CHECK on status', async () => {
    await assertConstraintExists(pool, 'tenant', 'PRIMARY KEY');
    await assertConstraintExists(pool, 'tenant', 'UNIQUE');
    await assertConstraintExists(pool, 'tenant', 'CHECK');
  });

  it('rejects invalid status value', async () => {
    await expect(
      pool.query(
        `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url, status)
         VALUES ('t-bad', 'Bad', 'realm', 'https://kc/realms/realm', 'nonsense')`,
      ),
    ).rejects.toThrow(/tenant_status_check|check constraint/i);
  });

  it('enforces unique code', async () => {
    await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-uniq', 'A', 'r', 'https://kc/realms/r')`,
    );
    await expect(
      pool.query(
        `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
         VALUES ('t-uniq', 'B', 'r', 'https://kc/realms/r')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });
});
