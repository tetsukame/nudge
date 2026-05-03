import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe('platform_admin', () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('inserts and reads rows', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO platform_admin (email, display_name, password_hash)
       VALUES ('admin@test.dev', 'Admin', '$2b$12$dummy')
       RETURNING id`,
    );
    expect(rows[0].id).toBeDefined();
  });

  it('rejects duplicate email', async () => {
    await pool.query(
      `INSERT INTO platform_admin (email, display_name, password_hash)
       VALUES ('dup@test.dev', 'A', 'h1')`,
    );
    await expect(
      pool.query(
        `INSERT INTO platform_admin (email, display_name, password_hash)
         VALUES ('dup@test.dev', 'B', 'h2')`,
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('defaults status to active', async () => {
    const { rows } = await pool.query<{ status: string }>(
      `INSERT INTO platform_admin (email, display_name, password_hash)
       VALUES ('default@test.dev', 'Def', 'h')
       RETURNING status`,
    );
    expect(rows[0].status).toBe('active');
  });

  it('rejects invalid status value', async () => {
    await expect(
      pool.query(
        `INSERT INTO platform_admin (email, display_name, password_hash, status)
         VALUES ('bad@test.dev', 'B', 'h', 'banned')`,
      ),
    ).rejects.toThrow(/check/i);
  });
});
