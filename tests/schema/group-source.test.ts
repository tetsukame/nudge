import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe('group.source', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string;

  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-gs', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'gs', 'gs@x', 'GS') RETURNING id`, [tenantId],
    )).rows[0].id;
  });

  afterAll(async () => { await stopTestDb(); });

  it('defaults to nudge when omitted', async () => {
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO "group" (tenant_id, name, created_by_user_id)
       VALUES ($1, 'g1', $2) RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    const { rows } = await pool.query<{ source: string }>(
      `SELECT source FROM "group" WHERE id=$1`, [id],
    );
    expect(rows[0].source).toBe('nudge');
  });

  it('accepts keycloak as a value', async () => {
    const id = (await pool.query<{ id: string }>(
      `INSERT INTO "group" (tenant_id, name, created_by_user_id, source)
       VALUES ($1, 'g2', $2, 'keycloak') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    const { rows } = await pool.query<{ source: string }>(
      `SELECT source FROM "group" WHERE id=$1`, [id],
    );
    expect(rows[0].source).toBe('keycloak');
  });

  it('rejects unknown source values', async () => {
    await expect(
      pool.query(
        `INSERT INTO "group" (tenant_id, name, created_by_user_id, source)
         VALUES ($1, 'g3', $2, 'azure_ad')`, [tenantId, userId],
      ),
    ).rejects.toThrow(/check/i);
  });
});
