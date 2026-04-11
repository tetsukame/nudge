import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

/**
 * 2 つのテナントを作り、それぞれに users を 1 件ずつ入れる。
 * SET LOCAL app.tenant_id = T1 のセッションから T2 のデータが
 * 見えないこと、および INSERT できないことを検証する。
 *
 * SET LOCAL はトランザクション内でのみ有効なので、各ケースを
 * BEGIN/ROLLBACK で囲む（ROLLBACK にすることでテストは副作用を残さない）。
 */
describe('tenant RLS isolation', () => {
  let pool: pg.Pool;
  let t1: string, t2: string;
  beforeAll(async () => {
    pool = await startTestDb();
    t1 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('iso-1', 'T1', 'r1', 'https://kc/r1') RETURNING id`,
    )).rows[0].id;
    t2 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('iso-2', 'T2', 'r2', 'https://kc/r2') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,'s1','a@t1','A'), ($2,'s2','b@t2','B')`,
      [t1, t2],
    );
  });
  afterAll(async () => { await stopTestDb(); });

  it('SELECT sees only current tenant rows', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE nudge_app`);
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      const { rows } = await client.query(`SELECT email FROM users`);
      expect(rows.map((r) => r.email)).toEqual(['a@t1']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('INSERT with wrong tenant_id is rejected by WITH CHECK', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE nudge_app`);
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

  it('UPDATE cannot reach other tenant rows (zero affected)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE nudge_app`);
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      const res = await client.query(
        `UPDATE users SET display_name='HACKED' WHERE email='b@t2'`,
      );
      expect(res.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('DELETE cannot reach other tenant rows (zero affected)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE nudge_app`);
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      const res = await client.query(`DELETE FROM users WHERE email='b@t2'`);
      expect(res.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('session with unset app.tenant_id fails closed (zero rows, insert rejected)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE nudge_app`);
      // deliberately do NOT SET app.tenant_id
      const sel = await client.query(`SELECT email FROM users`);
      expect(sel.rows.length).toBe(0);
      await expect(
        client.query(
          `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
           VALUES ($1,'sX','x@x','X')`,
          [t1],
        ),
      ).rejects.toThrow(/row-level security|new row violates/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
