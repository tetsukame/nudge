import { describe, it, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { assertColumn } from '../helpers/schema-assertions.js';

describe('migration 032: tenant_settings webhook URL columns', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('teams_webhook_url_encrypted exists, type=text, nullable=YES', async () => {
    const pool = getPool();
    await assertColumn(pool, 'tenant_settings', 'teams_webhook_url_encrypted', 'text', true);
  });

  it('slack_webhook_url_encrypted exists, type=text, nullable=YES', async () => {
    const pool = getPool();
    await assertColumn(pool, 'tenant_settings', 'slack_webhook_url_encrypted', 'text', true);
  });
});
