import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('tenant_settings', () => {
  let pool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-ts', 'TenantSettings', 'r-ts', 'https://kc/realms/r-ts') RETURNING id`,
    )).rows[0].id;
  });

  afterAll(async () => { await stopTestDb(); });

  it('table exists with all expected columns', async () => {
    await assertTableExists(pool, 'tenant_settings');

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenant_settings'
       ORDER BY ordinal_position`,
    );
    const columnNames = rows.map((r) => r.column_name);
    expect(columnNames).toEqual([
      'tenant_id',
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_password_encrypted',
      'smtp_from',
      'smtp_secure',
      'reminder_before_days',
      're_notify_interval_days',
      're_notify_max_count',
      'updated_at',
    ]);
  });

  it('reminder defaults are 1 / 3 / 5', async () => {
    await pool.query(
      `INSERT INTO tenant_settings (tenant_id) VALUES ($1)`,
      [tenantId],
    );
    const { rows } = await pool.query(
      `SELECT reminder_before_days, re_notify_interval_days, re_notify_max_count
       FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].reminder_before_days).toBe(1);
    expect(rows[0].re_notify_interval_days).toBe(3);
    expect(rows[0].re_notify_max_count).toBe(5);
  });

  it('RLS policy exists', async () => {
    const { rows } = await pool.query(
      `SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'tenant_settings'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((r: { policyname: string }) => r.policyname)).toContain(
      'tenant_settings_isolation',
    );
  });
});
