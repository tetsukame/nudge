import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn, assertTableExists } from '../helpers/schema-assertions.js';

describe('org_unit_closure table', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    const r = await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-cl', 'T', 'r', 'https://kc/r') RETURNING id`,
    );
    tenantId = r.rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists with columns', async () => {
    await assertTableExists(pool, 'org_unit_closure');
    await assertColumn(pool, 'org_unit_closure', 'ancestor_id', 'uuid', false);
    await assertColumn(pool, 'org_unit_closure', 'descendant_id', 'uuid', false);
    await assertColumn(pool, 'org_unit_closure', 'depth', 'smallint', false);
  });

  it('supports descendant lookup via JOIN', async () => {
    const root = (await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'HQ', 0) RETURNING id`,
      [tenantId],
    )).rows[0].id;
    const dept = (await pool.query(
      `INSERT INTO org_unit (tenant_id, parent_id, name, level) VALUES ($1, $2, 'Dept', 1) RETURNING id`,
      [tenantId, root],
    )).rows[0].id;
    const sec = (await pool.query(
      `INSERT INTO org_unit (tenant_id, parent_id, name, level) VALUES ($1, $2, 'Sec', 2) RETURNING id`,
      [tenantId, dept],
    )).rows[0].id;

    for (const [anc, desc, d] of [
      [root, root, 0], [dept, dept, 0], [sec, sec, 0],
      [root, dept, 1], [root, sec, 2], [dept, sec, 1],
    ] as const) {
      await pool.query(
        `INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, anc, desc, d],
      );
    }

    const { rows } = await pool.query<{ id: string }>(
      `SELECT descendant_id AS id FROM org_unit_closure WHERE ancestor_id = $1 ORDER BY depth`,
      [root],
    );
    expect(rows.map((r) => r.id)).toEqual([root, dept, sec]);
  });
});
