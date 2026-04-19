import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 029: request.last_viewed_by_requester_at', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('column exists as nullable timestamptz', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='request' AND column_name='last_viewed_by_requester_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('timestamp with time zone');
    expect(rows[0].is_nullable).toBe('YES');
  });
});
