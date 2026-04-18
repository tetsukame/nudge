import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 028: request_comment + last_viewed_at', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('request_comment table exists with expected columns', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='request_comment'
        ORDER BY ordinal_position`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'id', 'tenant_id', 'request_id', 'assignment_id',
      'author_user_id', 'body', 'created_at',
    ]);
  });

  it('assignment_id is nullable (broadcast vs individual)', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name='request_comment' AND column_name='assignment_id'`,
    );
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('assignment.last_viewed_at exists as nullable timestamptz', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='assignment' AND column_name='last_viewed_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('timestamp with time zone');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('RLS policy exists on request_comment', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT policyname FROM pg_policies WHERE tablename='request_comment'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
