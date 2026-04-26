import { describe, it, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { assertColumn, assertIndexExists } from '../helpers/schema-assertions.js';

describe('migration 033: notification.next_attempt_at + retry index', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('next_attempt_at column exists, type=timestamp with time zone, nullable=YES', async () => {
    const pool = getPool();
    await assertColumn(pool, 'notification', 'next_attempt_at', 'timestamp with time zone', true);
  });

  it('notification_retry_idx index exists', async () => {
    const pool = getPool();
    await assertIndexExists(pool, 'notification', 'notification_retry_idx');
  });
});
