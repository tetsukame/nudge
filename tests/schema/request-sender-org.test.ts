import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe('request.sender_org_unit_id', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, orgUnitId: string;

  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-so', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'so', 'so@x', 'SO') RETURNING id`, [tenantId],
    )).rows[0].id;
    orgUnitId = (await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'HR', 0) RETURNING id`,
      [tenantId],
    )).rows[0].id;
  });

  afterAll(async () => { await stopTestDb(); });

  it('column is nullable and defaults to NULL', async () => {
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO request (tenant_id, created_by_user_id, title)
       VALUES ($1,$2,'T') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    const { rows } = await pool.query<{ sender_org_unit_id: string | null }>(
      `SELECT sender_org_unit_id FROM request WHERE id = $1`, [id],
    );
    expect(rows[0].sender_org_unit_id).toBeNull();
  });

  it('accepts a valid org_unit FK', async () => {
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO request (tenant_id, created_by_user_id, title, sender_org_unit_id)
       VALUES ($1,$2,'T',$3) RETURNING id`,
      [tenantId, userId, orgUnitId],
    )).rows[0].id;
    const { rows } = await pool.query<{ sender_org_unit_id: string }>(
      `SELECT sender_org_unit_id FROM request WHERE id = $1`, [id],
    );
    expect(rows[0].sender_org_unit_id).toBe(orgUnitId);
  });

  it('rejects non-existent org_unit FK', async () => {
    await expect(
      pool.query(
        `INSERT INTO request (tenant_id, created_by_user_id, title, sender_org_unit_id)
         VALUES ($1,$2,'T','00000000-0000-0000-0000-000000000000')`,
        [tenantId, userId],
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});
