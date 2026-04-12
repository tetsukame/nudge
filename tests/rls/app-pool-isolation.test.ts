import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';

/**
 * Verify that RLS is enforced when connecting as nudge_app (non-superuser).
 * This is distinct from tests/rls/tenant-isolation.test.ts which uses
 * SET LOCAL ROLE nudge_app from within a superuser connection.
 */
describe('RLS via appPool (real nudge_app LOGIN connection)', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let t1: string, t2: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    t1 = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('ap-1','T1','r1','https://kc/r1') RETURNING id`,
    )).rows[0].id;
    t2 = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('ap-2','T2','r2','https://kc/r2') RETURNING id`,
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,'s1','a@t1','A'),($2,'s2','b@t2','B')`,
      [t1, t2],
    );
  });
  afterAll(async () => { await stopTestDb(); });

  it('appPool SELECT sees only current tenant rows', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      const { rows } = await client.query(`SELECT email FROM users`);
      expect(rows.map((r) => r.email)).toEqual(['a@t1']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('appPool INSERT with wrong tenant_id is rejected', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      await expect(
        client.query(
          `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
           VALUES ($1,'s3','c@t2','C')`,
          [t2],
        ),
      ).rejects.toThrow(/row-level security|new row violates/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
