import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('tenant_notification_config', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-nc', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'tenant_notification_config'); });

  it('stores channel config as JSONB', async () => {
    await pool.query(
      `INSERT INTO tenant_notification_config (tenant_id, channel, enabled, config_json)
       VALUES ($1, 'email', true, $2::jsonb)`,
      [tenantId, JSON.stringify({ smtp_host: 'smtp.example.com', smtp_port: 587 })],
    );
    const { rows } = await pool.query<{ config_json: { smtp_host: string } }>(
      `SELECT config_json FROM tenant_notification_config WHERE tenant_id=$1 AND channel='email'`,
      [tenantId],
    );
    expect(rows[0].config_json.smtp_host).toBe('smtp.example.com');
  });

  it('rejects invalid channel', async () => {
    await expect(
      pool.query(
        `INSERT INTO tenant_notification_config (tenant_id, channel) VALUES ($1, 'sms')`,
        [tenantId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
