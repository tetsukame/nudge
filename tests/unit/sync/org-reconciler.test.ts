import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../../helpers/pg-container.js';
import { reconcileOrgs } from '../../../src/sync/org-reconciler.js';
import type { OrgSyncSource, SyncOrgRecord, OrgMembership } from '../../../src/sync/types.js';

function mockOrgSource(
  orgs: SyncOrgRecord[],
  memberships: OrgMembership[] = [],
): OrgSyncSource {
  return {
    async *fetchAllOrgs() { yield orgs; },
    async *fetchOrgMemberships() { yield memberships; },
  };
}

describe('reconcileOrgs', () => {
  let adminPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('or-test', 'OR', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await adminPool.query(`DELETE FROM user_org_unit WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM org_unit_closure WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM org_unit WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
  });

  it('creates org_unit tree from flat records', async () => {
    const source = mockOrgSource([
      { externalId: 'hq', name: '本部', parentExternalId: null, level: 0 },
      { externalId: 'dept', name: '総務部', parentExternalId: 'hq', level: 1 },
      { externalId: 'sec', name: '総務課', parentExternalId: 'dept', level: 2 },
    ]);
    const result = await reconcileOrgs(adminPool, tenantId, source);
    expect(result.created).toBe(3);

    const { rows } = await adminPool.query(
      `SELECT name, level, external_id FROM org_unit WHERE tenant_id = $1 ORDER BY level`,
      [tenantId],
    );
    expect(rows).toEqual([
      { name: '本部', level: 0, external_id: 'hq' },
      { name: '総務部', level: 1, external_id: 'dept' },
      { name: '総務課', level: 2, external_id: 'sec' },
    ]);
  });

  it('rebuilds org_unit_closure correctly', async () => {
    const source = mockOrgSource([
      { externalId: 'hq', name: 'HQ', parentExternalId: null, level: 0 },
      { externalId: 'dept', name: 'Dept', parentExternalId: 'hq', level: 1 },
      { externalId: 'sec', name: 'Sec', parentExternalId: 'dept', level: 2 },
    ]);
    await reconcileOrgs(adminPool, tenantId, source);

    const { rows } = await adminPool.query(
      `SELECT o.name, c.depth
       FROM org_unit_closure c JOIN org_unit o ON c.descendant_id = o.id
       WHERE c.tenant_id = $1
         AND c.ancestor_id = (SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = 'hq')
       ORDER BY c.depth`,
      [tenantId],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['HQ', 'Dept', 'Sec']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  it('updates changed org name', async () => {
    await reconcileOrgs(adminPool, tenantId, mockOrgSource([
      { externalId: 'a', name: 'Old', parentExternalId: null, level: 0 },
    ]));
    const result = await reconcileOrgs(adminPool, tenantId, mockOrgSource([
      { externalId: 'a', name: 'New', parentExternalId: null, level: 0 },
    ]));
    expect(result.updated).toBe(1);
    const { rows } = await adminPool.query(
      `SELECT name FROM org_unit WHERE tenant_id = $1 AND external_id = 'a'`, [tenantId],
    );
    expect(rows[0].name).toBe('New');
  });

  it('archives org_unit (no members) when missing from source, preserving the row', async () => {
    await reconcileOrgs(adminPool, tenantId, mockOrgSource([
      { externalId: 'gone', name: 'Gone', parentExternalId: null, level: 0 },
    ]));
    const result = await reconcileOrgs(adminPool, tenantId, mockOrgSource([]));
    expect(result.removed).toBe(1);
    const { rows } = await adminPool.query<{ status: string; archived_at: Date | null }>(
      `SELECT status, archived_at FROM org_unit WHERE tenant_id = $1 AND external_id = 'gone'`,
      [tenantId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('archived');
    expect(rows[0].archived_at).not.toBeNull();
  });

  it('archives org_unit (with members) when missing from source, preserving membership rows', async () => {
    await reconcileOrgs(adminPool, tenantId, mockOrgSource([
      { externalId: 'kept', name: 'Kept', parentExternalId: null, level: 0 },
    ]));
    const userId = (await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'u1', 'u@x', 'U') RETURNING id`, [tenantId],
    )).rows[0].id;
    const ouId = (await adminPool.query(
      `SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = 'kept'`, [tenantId],
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary) VALUES ($1,$2,$3,true)`,
      [tenantId, userId, ouId],
    );
    const result = await reconcileOrgs(adminPool, tenantId, mockOrgSource([]));
    expect(result.removed).toBe(1);
    const { rows: orgRows } = await adminPool.query<{ status: string }>(
      `SELECT status FROM org_unit WHERE id = $1`, [ouId],
    );
    expect(orgRows[0].status).toBe('archived');
    const { rows: memberRows } = await adminPool.query(
      `SELECT 1 FROM user_org_unit WHERE org_unit_id = $1 AND user_id = $2`, [ouId, userId],
    );
    expect(memberRows.length).toBe(1);
  });

  it('restores archived org_unit when it reappears in source', async () => {
    await reconcileOrgs(adminPool, tenantId, mockOrgSource([
      { externalId: 'cycle', name: 'Cycle', parentExternalId: null, level: 0 },
    ]));
    await reconcileOrgs(adminPool, tenantId, mockOrgSource([])); // archive
    const result = await reconcileOrgs(adminPool, tenantId, mockOrgSource([
      { externalId: 'cycle', name: 'Cycle', parentExternalId: null, level: 0 },
    ]));
    expect(result.updated).toBe(1);
    const { rows } = await adminPool.query<{ status: string; archived_at: Date | null }>(
      `SELECT status, archived_at FROM org_unit WHERE tenant_id = $1 AND external_id = 'cycle'`,
      [tenantId],
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].archived_at).toBeNull();
  });

  it('syncs memberships from source', async () => {
    const userId = (await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'mem-u1', 'mu@x', 'MU') RETURNING id`, [tenantId],
    )).rows[0].id;
    const source = mockOrgSource(
      [{ externalId: 'org-m', name: 'OrgM', parentExternalId: null, level: 0 }],
      [{ orgExternalId: 'org-m', userExternalId: 'mem-u1', isPrimary: true }],
    );
    const result = await reconcileOrgs(adminPool, tenantId, source);
    expect(result.membershipsUpdated).toBeGreaterThanOrEqual(1);
    const { rows } = await adminPool.query(
      `SELECT is_primary FROM user_org_unit WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId],
    );
    expect(rows[0].is_primary).toBe(true);
  });
});
