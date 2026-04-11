import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('group + group_member', () => {
  let pool: pg.Pool;
  let tenantId: string, creator: string, member: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-grp', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    creator = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'c', 'c@x', 'C') RETURNING id`, [tenantId],
    )).rows[0].id;
    member = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'm', 'm@x', 'M') RETURNING id`, [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('group table exists', async () => { await assertTableExists(pool, 'group'); });
  it('group_member table exists', async () => { await assertTableExists(pool, 'group_member'); });

  it('cascades member rows on group delete', async () => {
    const g = (await pool.query(
      `INSERT INTO "group" (tenant_id, name, created_by_user_id)
       VALUES ($1, 'G1', $2) RETURNING id`, [tenantId, creator],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO group_member (tenant_id, group_id, user_id, added_by_user_id)
       VALUES ($1, $2, $3, $3)`, [tenantId, g, member],
    );
    await pool.query(`DELETE FROM "group" WHERE id = $1`, [g]);
    const { rows } = await pool.query(
      `SELECT 1 FROM group_member WHERE group_id = $1`, [g],
    );
    expect(rows.length).toBe(0);
  });
});
