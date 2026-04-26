import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 031: notification status sending', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('accepts status=sending', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT consrc FROM pg_constraint WHERE conname = 'notification_status_check'`,
    ).catch(async () => {
      // PG12+ uses pg_get_constraintdef
      return pool.query(
        `SELECT pg_get_constraintdef(oid) AS consrc FROM pg_constraint WHERE conname='notification_status_check'`,
      );
    });
    expect(rows[0].consrc).toMatch(/sending/);
  });
});
