import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

const TENANT_SCOPED = [
  'users','org_unit','org_unit_closure','user_org_unit','org_unit_manager',
  'group','group_member','user_role',
  'request','request_target','assignment','assignment_status_history',
  'tenant_notification_config','user_notification_pref','notification_rule','notification',
  'audit_log',
] as const;

describe('RLS coverage', () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('every tenant-scoped table has RLS enabled and forced', async () => {
    const { rows } = await pool.query<{ relname: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity AS rowsecurity, relforcerowsecurity AS forcerowsecurity
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relkind = 'r'
         AND relname = ANY($1::text[])`,
      [TENANT_SCOPED as unknown as string[]],
    );
    expect(rows.length).toBe(TENANT_SCOPED.length);
    for (const r of rows) {
      expect(r.rowsecurity, `${r.relname} rowsecurity`).toBe(true);
      expect(r.forcerowsecurity, `${r.relname} forcerowsecurity`).toBe(true);
    }
  });

  it('tenant table also has RLS + force after hardening', async () => {
    const { rows } = await pool.query<{ rowsecurity: boolean; forcerowsecurity: boolean }>(
      `SELECT relrowsecurity AS rowsecurity, relforcerowsecurity AS forcerowsecurity
       FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='tenant'`,
    );
    expect(rows[0].rowsecurity).toBe(true);
    expect(rows[0].forcerowsecurity).toBe(true);
  });

  it('every tenant-scoped table has a tenant_isolation policy', async () => {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
       WHERE schemaname='public' AND policyname='tenant_isolation'
         AND tablename = ANY($1::text[])`,
      [TENANT_SCOPED as unknown as string[]],
    );
    expect(rows.length).toBe(TENANT_SCOPED.length);
  });

  it('tenant table has tenant_isolation policy too', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename='tenant' AND policyname='tenant_isolation'`,
    );
    expect(rows.length).toBe(1);
  });
});
