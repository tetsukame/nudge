import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn } from '../helpers/schema-assertions.js';

describe('org_unit.external_id', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('oei-test', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('has nullable external_id column', async () => {
    await assertColumn(pool, 'org_unit', 'external_id', 'text', true);
  });

  it('allows null external_id', async () => {
    await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'Manual', 0)`,
      [tenantId],
    );
  });

  it('enforces unique within tenant when not null', async () => {
    await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level, external_id)
       VALUES ($1, 'A', 0, 'ext-1')`,
      [tenantId],
    );
    await expect(
      pool.query(
        `INSERT INTO org_unit (tenant_id, name, level, external_id)
         VALUES ($1, 'B', 0, 'ext-1')`,
        [tenantId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('allows same external_id across tenants', async () => {
    const t2 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('oei-t2', 'T2', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level, external_id)
       VALUES ($1, 'C', 0, 'ext-1')`,
      [t2],
    );
  });
});
