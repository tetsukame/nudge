import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('request_target', () => {
  let pool: pg.Pool;
  let tenantId: string, creator: string, requestId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-rt', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    creator = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 's', 's@x', 'S') RETURNING id`, [tenantId],
    )).rows[0].id;
    requestId = (await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, type, title)
       VALUES ($1,$2,'task','X') RETURNING id`, [tenantId, creator],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'request_target'); });

  it('accepts all target_type values', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    for (const t of ['org_unit', 'group', 'user']) {
      await pool.query(
        `INSERT INTO request_target (tenant_id, request_id, target_type, target_id)
         VALUES ($1,$2,$3,$4)`, [tenantId, requestId, t, fakeId],
      );
    }
  });

  it('rejects invalid target_type', async () => {
    await expect(
      pool.query(
        `INSERT INTO request_target (tenant_id, request_id, target_type, target_id)
         VALUES ($1,$2,'role','00000000-0000-0000-0000-000000000002')`,
        [tenantId, requestId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('cascades on request delete', async () => {
    const r = (await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, type, title)
       VALUES ($1,$2,'task','Y') RETURNING id`, [tenantId, creator],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO request_target (tenant_id, request_id, target_type, target_id)
       VALUES ($1,$2,'user','00000000-0000-0000-0000-000000000003')`,
      [tenantId, r],
    );
    await pool.query(`DELETE FROM request WHERE id = $1`, [r]);
    const { rows } = await pool.query(
      `SELECT 1 FROM request_target WHERE request_id = $1`, [r],
    );
    expect(rows.length).toBe(0);
  });
});
