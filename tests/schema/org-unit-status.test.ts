import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe('org_unit.status', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-os', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('defaults to active', async () => {
    const { rows } = await pool.query<{ status: string }>(
      `INSERT INTO org_unit (tenant_id, name, level)
       VALUES ($1, 'X', 0) RETURNING status`,
      [tenantId],
    );
    expect(rows[0].status).toBe('active');
  });

  it('accepts archived', async () => {
    const { rows } = await pool.query<{ status: string; archived_at: Date | null }>(
      `INSERT INTO org_unit (tenant_id, name, level, status, archived_at)
       VALUES ($1, 'Y', 0, 'archived', now()) RETURNING status, archived_at`,
      [tenantId],
    );
    expect(rows[0].status).toBe('archived');
    expect(rows[0].archived_at).not.toBeNull();
  });

  it('rejects unknown status', async () => {
    await expect(
      pool.query(
        `INSERT INTO org_unit (tenant_id, name, level, status)
         VALUES ($1, 'Z', 0, 'deleted')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check/i);
  });
});
