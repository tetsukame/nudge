import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn, assertIndexExists, assertTableExists } from '../helpers/schema-assertions.js';

describe('sync_log table', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sl-test', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists with required columns', async () => {
    await assertTableExists(pool, 'sync_log');
    await assertColumn(pool, 'sync_log', 'sync_type', 'text', false);
    await assertColumn(pool, 'sync_log', 'status', 'text', false);
    await assertColumn(pool, 'sync_log', 'created_count', 'integer', false);
  });

  it('has index on tenant_id + started_at', async () => {
    await assertIndexExists(pool, 'sync_log', '%tenant_started%');
  });

  it('accepts valid sync_type and status values', async () => {
    await pool.query(
      `INSERT INTO sync_log (tenant_id, sync_type, status, created_count, updated_count, deactivated_count, reactivated_count)
       VALUES ($1, 'full', 'success', 10, 2, 1, 0)`,
      [tenantId],
    );
    await pool.query(
      `INSERT INTO sync_log (tenant_id, sync_type, status)
       VALUES ($1, 'delta', 'running')`,
      [tenantId],
    );
  });

  it('rejects invalid sync_type', async () => {
    await expect(
      pool.query(
        `INSERT INTO sync_log (tenant_id, sync_type, status) VALUES ($1, 'incremental', 'running')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('rejects invalid status', async () => {
    await expect(
      pool.query(
        `INSERT INTO sync_log (tenant_id, sync_type, status) VALUES ($1, 'full', 'pending')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
