import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { CsvSyncSource } from '../../src/sync/csv-source.js';
import { reconcileOrgs } from '../../src/sync/org-reconciler.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';

const CSV = [
  'employee_id,email,display_name,org_path,is_primary',
  'emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/DX推進,false',
  'emp-003,yamada@city.lg.jp,山田太郎,/総務本部/総務部/総務課,true',
].join('\n');

describe('CSV import integration', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('csv-int', 'CSV Int', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('imports CSV with orgs, users, and memberships', async () => {
    const source = new CsvSyncSource(CSV);

    // Orgs first (structure only — memberships need users to exist)
    const orgResult = await reconcileOrgs(adminPool, tenantId, source);
    // 5 orgs: /総務本部(0), /総務本部/総務部(1), /総務本部/総務部/総務課(2), /総務本部/総務部/人事課(2), /DX推進(0)
    expect(orgResult.created).toBe(5);

    // Then users
    const userResult = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    expect(userResult.created).toBe(3); // emp-001, emp-002, emp-003

    // Re-run org sync so memberships are applied (users now exist)
    const orgResult2 = await reconcileOrgs(adminPool, tenantId, source);
    expect(orgResult2.membershipsUpdated).toBeGreaterThanOrEqual(4); // 4 CSV rows with org assignments

    // Verify org_unit_closure: HQ → 総務本部 → 総務部 → 総務課, 人事課
    const { rows: hqDescendants } = await adminPool.query(
      `SELECT o.name FROM org_unit_closure c
       JOIN org_unit o ON o.id = c.descendant_id
       WHERE c.tenant_id = $1
         AND c.ancestor_id = (SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = '/総務本部')
       ORDER BY c.depth, o.name`,
      [tenantId],
    );
    // Should include 総務本部(self), 総務部, 人事課, 総務課
    expect(hqDescendants.length).toBeGreaterThanOrEqual(3);
    expect(hqDescendants[0].name).toBe('総務本部'); // depth 0 = self

    // Verify user_org_unit for suzuki (emp-002) — 2 orgs
    const { rows: suzukiOrgs } = await adminPool.query(
      `SELECT o.name, uou.is_primary FROM user_org_unit uou
       JOIN org_unit o ON o.id = uou.org_unit_id
       JOIN users u ON u.id = uou.user_id
       WHERE uou.tenant_id = $1 AND u.keycloak_sub = 'emp-002'
       ORDER BY o.name`,
      [tenantId],
    );
    expect(suzukiOrgs).toHaveLength(2);
    // DX推進 = false, 人事課 = true
    expect(suzukiOrgs.find((r) => r.name === 'DX推進')?.is_primary).toBe(false);
    expect(suzukiOrgs.find((r) => r.name === '人事課')?.is_primary).toBe(true);
  });
});
