import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe('request.estimated_minutes', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string;

  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-em', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'em', 'em@x', 'EM') RETURNING id`, [tenantId],
    )).rows[0].id;
  });

  afterAll(async () => { await stopTestDb(); });

  it('column exists with default 5', async () => {
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO request (tenant_id, created_by_user_id, title)
       VALUES ($1,$2,'T') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    const { rows } = await pool.query<{ estimated_minutes: number }>(
      `SELECT estimated_minutes FROM request WHERE id = $1`, [id],
    );
    expect(rows[0].estimated_minutes).toBe(5);
  });

  it('accepts explicit positive value', async () => {
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO request (tenant_id, created_by_user_id, title, estimated_minutes)
       VALUES ($1,$2,'T',90) RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    const { rows } = await pool.query<{ estimated_minutes: number }>(
      `SELECT estimated_minutes FROM request WHERE id = $1`, [id],
    );
    expect(rows[0].estimated_minutes).toBe(90);
  });

  it('rejects zero or negative', async () => {
    await expect(
      pool.query(
        `INSERT INTO request (tenant_id, created_by_user_id, title, estimated_minutes)
         VALUES ($1,$2,'T',0)`, [tenantId, userId],
      ),
    ).rejects.toThrow(/check/i);
    await expect(
      pool.query(
        `INSERT INTO request (tenant_id, created_by_user_id, title, estimated_minutes)
         VALUES ($1,$2,'T',-5)`, [tenantId, userId],
      ),
    ).rejects.toThrow(/check/i);
  });
});
