import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';
import type { SyncSource, SyncUserRecord } from '../../src/sync/types.js';

function mockSource(users: SyncUserRecord[]): SyncSource {
  return {
    async *fetchAllUsers() {
      yield users;
    },
  };
}

describe('NDG-48 KC position → manager sync', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let tenantId: string;
  let orgId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('ps-test', 'PS', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO tenant_sync_config (tenant_id, enabled) VALUES ($1, true)`,
      [tenantId],
    );
    orgId = (await adminPool.query(
      `INSERT INTO org_unit (tenant_id, parent_id, name, level)
       VALUES ($1, NULL, '戦略課', 0) RETURNING id`,
      [tenantId],
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
       VALUES ($1, $2, $2, 0)`,
      [tenantId, orgId],
    );
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await adminPool.query(`DELETE FROM org_unit_manager WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM user_role WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM user_org_unit WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM tenant_position_config WHERE tenant_id = $1`, [tenantId]);
  });

  async function primaryOrg(keycloakSub: string) {
    const { rows } = await adminPool.query(
      `SELECT id FROM users WHERE tenant_id=$1 AND keycloak_sub=$2`,
      [tenantId, keycloakSub],
    );
    await adminPool.query(
      `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (user_id, org_unit_id) DO UPDATE SET is_primary = true`,
      [tenantId, rows[0].id, orgId],
    );
    return rows[0].id as string;
  }

  it('default manager positions promote 課長 to manager and attach primary org', async () => {
    // First sync creates the user (no position → not manager)
    await reconcileUsers(
      appPool, adminPool, tenantId,
      mockSource([
        { externalId: 'k1', email: 'k1@x', displayName: 'Kacho', active: true, position: null },
      ]),
      'full',
    );
    const userId = await primaryOrg('k1');

    // Second sync: position becomes 課長 (default manager_positions includes it)
    await reconcileUsers(
      appPool, adminPool, tenantId,
      mockSource([
        { externalId: 'k1', email: 'k1@x', displayName: 'Kacho', active: true, position: '課長' },
      ]),
      'full',
    );

    const { rows: roleRows } = await adminPool.query(
      `SELECT 1 FROM user_role WHERE user_id=$1 AND role='manager'`,
      [userId],
    );
    expect(roleRows).toHaveLength(1);

    const { rows: uRows } = await adminPool.query(
      `SELECT manager_source, synced_position FROM users WHERE id=$1`,
      [userId],
    );
    expect(uRows[0].manager_source).toBe('kc');
    expect(uRows[0].synced_position).toBe('課長');

    // org_unit_manager re-attached to the primary org
    const { rows: omRows } = await adminPool.query(
      `SELECT org_unit_id FROM org_unit_manager WHERE user_id=$1`,
      [userId],
    );
    expect(omRows.map((r) => r.org_unit_id)).toEqual([orgId]);

    // Demotion: position drops to 一般 → manager removed
    await reconcileUsers(
      appPool, adminPool, tenantId,
      mockSource([
        { externalId: 'k1', email: 'k1@x', displayName: 'Kacho', active: true, position: '一般' },
      ]),
      'full',
    );
    const { rows: roleAfter } = await adminPool.query(
      `SELECT 1 FROM user_role WHERE user_id=$1 AND role='manager'`,
      [userId],
    );
    expect(roleAfter).toHaveLength(0);
    const { rows: omAfter } = await adminPool.query(
      `SELECT 1 FROM org_unit_manager WHERE user_id=$1`,
      [userId],
    );
    expect(omAfter).toHaveLength(0);
  });

  it('manual_source locks the user out of KC sync', async () => {
    await reconcileUsers(
      appPool, adminPool, tenantId,
      mockSource([
        { externalId: 'm1', email: 'm1@x', displayName: 'Manual', active: true, position: null },
      ]),
      'full',
    );
    const userId = await primaryOrg('m1');
    // Simulate an admin manual toggle: manager role + manual lock
    await adminPool.query(
      `INSERT INTO user_role (tenant_id, user_id, role) VALUES ($1,$2,'manager')`,
      [tenantId, userId],
    );
    await adminPool.query(
      `UPDATE users SET manager_source='manual' WHERE id=$1`,
      [userId],
    );

    // KC says 一般 (would normally demote) — but manual lock protects it
    await reconcileUsers(
      appPool, adminPool, tenantId,
      mockSource([
        { externalId: 'm1', email: 'm1@x', displayName: 'Manual', active: true, position: '一般' },
      ]),
      'full',
    );

    const { rows } = await adminPool.query(
      `SELECT 1 FROM user_role WHERE user_id=$1 AND role='manager'`,
      [userId],
    );
    expect(rows).toHaveLength(1); // still manager
    const { rows: u } = await adminPool.query(
      `SELECT manager_source, synced_position FROM users WHERE id=$1`,
      [userId],
    );
    expect(u[0].manager_source).toBe('manual');
    expect(u[0].synced_position).toBe('一般'); // position still recorded for visibility
  });

  it('respects a custom tenant_position_config', async () => {
    await adminPool.query(
      `INSERT INTO tenant_position_config (tenant_id, manager_positions)
       VALUES ($1, ARRAY['主任'])`,
      [tenantId],
    );
    await reconcileUsers(
      appPool, adminPool, tenantId,
      mockSource([
        { externalId: 'c1', email: 'c1@x', displayName: 'Shunin', active: true, position: '主任' },
        { externalId: 'c2', email: 'c2@x', displayName: 'Kacho', active: true, position: '課長' },
      ]),
      'full',
    );
    const { rows: shunin } = await adminPool.query(
      `SELECT 1 FROM user_role ur JOIN users u ON u.id=ur.user_id
        WHERE u.keycloak_sub='c1' AND ur.role='manager'`,
    );
    expect(shunin).toHaveLength(1);
    const { rows: kacho } = await adminPool.query(
      `SELECT 1 FROM user_role ur JOIN users u ON u.id=ur.user_id
        WHERE u.keycloak_sub='c2' AND ur.role='manager'`,
    );
    expect(kacho).toHaveLength(0); // 課長 not in custom list
  });
});
