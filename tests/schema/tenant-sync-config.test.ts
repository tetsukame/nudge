import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn, assertTableExists } from '../helpers/schema-assertions.js';

describe('tenant_sync_config table', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sc-test', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists with required columns', async () => {
    await assertTableExists(pool, 'tenant_sync_config');
    await assertColumn(pool, 'tenant_sync_config', 'tenant_id', 'uuid', false);
    await assertColumn(pool, 'tenant_sync_config', 'source_type', 'text', false);
    await assertColumn(pool, 'tenant_sync_config', 'enabled', 'boolean', false);
    await assertColumn(pool, 'tenant_sync_config', 'sync_client_id', 'text', true);
    await assertColumn(pool, 'tenant_sync_config', 'sync_client_secret', 'text', true);
    await assertColumn(pool, 'tenant_sync_config', 'interval_minutes', 'integer', false);
  });

  it('inserts and reads config', async () => {
    await pool.query(
      `INSERT INTO tenant_sync_config (tenant_id, enabled, sync_client_id, sync_client_secret)
       VALUES ($1, true, 'nudge-sync', 'secret-123')`,
      [tenantId],
    );
    const { rows } = await pool.query(
      `SELECT source_type, interval_minutes FROM tenant_sync_config WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].source_type).toBe('keycloak');
    expect(rows[0].interval_minutes).toBe(60);
  });

  it('rejects invalid source_type', async () => {
    const t2 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sc-bad', 'B', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO tenant_sync_config (tenant_id, source_type) VALUES ($1, 'ldap')`,
        [t2],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
