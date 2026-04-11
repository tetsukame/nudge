import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn, assertTableExists } from '../helpers/schema-assertions.js';

describe('org_unit table', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    const res = await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-ou', 'T', 'r', 'https://kc/r') RETURNING id`,
    );
    tenantId = res.rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists with columns', async () => {
    await assertTableExists(pool, 'org_unit');
    await assertColumn(pool, 'org_unit', 'parent_id', 'uuid', true);
    await assertColumn(pool, 'org_unit', 'level', 'smallint', false);
  });

  it('allows self-referential parent_id', async () => {
    const r1 = await pool.query(
      `INSERT INTO org_unit (tenant_id, parent_id, name, level)
       VALUES ($1, NULL, '本部', 0) RETURNING id`,
      [tenantId],
    );
    const root = r1.rows[0].id;
    const r2 = await pool.query(
      `INSERT INTO org_unit (tenant_id, parent_id, name, level)
       VALUES ($1, $2, '総務部', 1) RETURNING id`,
      [tenantId, root],
    );
    expect(r2.rows[0].id).toBeDefined();
  });
});
