import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('user_org_unit table', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, ou1: string, ou2: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-uou', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'sub', 'u@x', 'U') RETURNING id`,
      [tenantId],
    )).rows[0].id;
    ou1 = (await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'A', 0) RETURNING id`,
      [tenantId],
    )).rows[0].id;
    ou2 = (await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'B', 0) RETURNING id`,
      [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => {
    await assertTableExists(pool, 'user_org_unit');
  });

  it('allows multiple memberships per user', async () => {
    await pool.query(
      `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary)
       VALUES ($1, $2, $3, true), ($1, $2, $4, false)`,
      [tenantId, userId, ou1, ou2],
    );
    const { rows } = await pool.query(
      `SELECT org_unit_id FROM user_org_unit WHERE user_id = $1`,
      [userId],
    );
    expect(rows.length).toBe(2);
  });

  it('enforces single primary per user via partial unique index', async () => {
    await expect(
      pool.query(
        `UPDATE user_org_unit SET is_primary = true WHERE user_id = $1 AND org_unit_id = $2`,
        [userId, ou2],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
