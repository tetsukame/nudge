import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn } from '../helpers/schema-assertions.js';

describe('tenant_sync_config org columns', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sco-test', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('has user_source_type (renamed from source_type)', async () => {
    await assertColumn(pool, 'tenant_sync_config', 'user_source_type', 'text', false);
  });

  it('has org_source_type with default none', async () => {
    await assertColumn(pool, 'tenant_sync_config', 'org_source_type', 'text', false);
    await pool.query(
      `INSERT INTO tenant_sync_config (tenant_id) VALUES ($1)`,
      [tenantId],
    );
    const { rows } = await pool.query(
      `SELECT org_source_type FROM tenant_sync_config WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].org_source_type).toBe('none');
  });

  it('accepts keycloak, csv, none for both source types', async () => {
    const t2 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sco-kc', 'T2', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO tenant_sync_config (tenant_id, user_source_type, org_source_type)
       VALUES ($1, 'csv', 'keycloak')`,
      [t2],
    );
  });

  it('has org_group_prefix column', async () => {
    await assertColumn(pool, 'tenant_sync_config', 'org_group_prefix', 'text', true);
  });

  it('rejects invalid org_source_type', async () => {
    const t3 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sco-bad', 'T3', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO tenant_sync_config (tenant_id, org_source_type) VALUES ($1, 'ldap')`,
        [t3],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
