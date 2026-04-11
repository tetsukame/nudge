import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('org_unit_manager table', () => {
  let pool: pg.Pool;
  let tenantId: string, u1: string, u2: string, ou: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-oum', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    u1 = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 's1', 'a@x', 'A') RETURNING id`, [tenantId],
    )).rows[0].id;
    u2 = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 's2', 'b@x', 'B') RETURNING id`, [tenantId],
    )).rows[0].id;
    ou = (await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'Dept', 0) RETURNING id`,
      [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'org_unit_manager'); });

  it('allows multiple managers per org_unit', async () => {
    await pool.query(
      `INSERT INTO org_unit_manager (tenant_id, org_unit_id, user_id) VALUES ($1,$2,$3),($1,$2,$4)`,
      [tenantId, ou, u1, u2],
    );
    const { rows } = await pool.query(
      `SELECT user_id FROM org_unit_manager WHERE org_unit_id = $1`, [ou],
    );
    expect(rows.length).toBe(2);
  });
});
