import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe("sync_log.sync_type allows 'full-with-orgs'", () => {
  let pool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-sl-fwo', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('accepts full', async () => {
    await pool.query(
      `INSERT INTO sync_log (tenant_id, sync_type) VALUES ($1, 'full')`, [tenantId],
    );
  });
  it('accepts delta', async () => {
    await pool.query(
      `INSERT INTO sync_log (tenant_id, sync_type) VALUES ($1, 'delta')`, [tenantId],
    );
  });
  it('accepts full-with-orgs', async () => {
    await pool.query(
      `INSERT INTO sync_log (tenant_id, sync_type) VALUES ($1, 'full-with-orgs')`, [tenantId],
    );
  });
  it('rejects unknown values', async () => {
    await expect(
      pool.query(
        `INSERT INTO sync_log (tenant_id, sync_type) VALUES ($1, 'orgs-only')`, [tenantId],
      ),
    ).rejects.toThrow(/check/i);
  });
});
