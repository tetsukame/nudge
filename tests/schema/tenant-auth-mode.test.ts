import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn } from '../helpers/schema-assertions.js';

describe('tenant.auth_mode column', () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('has auth_mode column with default oidc', async () => {
    await assertColumn(pool, 'tenant', 'auth_mode', 'text', false);
    const { rows } = await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('am-test', 'T', 'r', 'https://kc/r') RETURNING auth_mode`,
    );
    expect(rows[0].auth_mode).toBe('oidc');
  });

  it('accepts oidc and local values', async () => {
    await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url, auth_mode)
       VALUES ('am-oidc', 'O', 'r', 'https://kc/r', 'oidc')`,
    );
    await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url, auth_mode)
       VALUES ('am-local', 'L', 'r', 'https://kc/r', 'local')`,
    );
  });

  it('rejects invalid auth_mode', async () => {
    await expect(
      pool.query(
        `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url, auth_mode)
         VALUES ('am-bad', 'B', 'r', 'https://kc/r', 'saml')`,
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
