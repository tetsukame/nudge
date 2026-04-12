import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../../helpers/pg-container.js';
import { reconcileUsers } from '../../../src/sync/reconciler.js';
import type { SyncSource, SyncUserRecord } from '../../../src/sync/types.js';

function mockSource(users: SyncUserRecord[]): SyncSource {
  return {
    async *fetchAllUsers() {
      yield users;
    },
  };
}

describe('reconcileUsers', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('rc-test', 'RC', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO tenant_sync_config (tenant_id, enabled) VALUES ($1, true)`,
      [tenantId],
    );
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await adminPool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
  });

  it('creates new users on full sync', async () => {
    const source = mockSource([
      { externalId: 'ext-1', email: 'a@x', displayName: 'Alice', active: true },
      { externalId: 'ext-2', email: 'b@x', displayName: 'Bob', active: true },
    ]);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    const { rows } = await adminPool.query(
      `SELECT keycloak_sub, email FROM users WHERE tenant_id = $1 ORDER BY email`,
      [tenantId],
    );
    expect(rows).toEqual([
      { keycloak_sub: 'ext-1', email: 'a@x' },
      { keycloak_sub: 'ext-2', email: 'b@x' },
    ]);
  });

  it('updates changed users', async () => {
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'ext-u', 'old@x', 'Old')`,
      [tenantId],
    );
    const source = mockSource([
      { externalId: 'ext-u', email: 'new@x', displayName: 'New', active: true },
    ]);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
    const { rows } = await adminPool.query(
      `SELECT email, display_name FROM users WHERE tenant_id = $1 AND keycloak_sub = 'ext-u'`,
      [tenantId],
    );
    expect(rows[0]).toEqual({ email: 'new@x', display_name: 'New' });
  });

  it('deactivates users missing from KC on full sync', async () => {
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1, 'ext-gone', 'gone@x', 'Gone', 'active')`,
      [tenantId],
    );
    const source = mockSource([]);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    expect(result.deactivated).toBe(1);
    const { rows } = await adminPool.query(
      `SELECT status FROM users WHERE tenant_id = $1 AND keycloak_sub = 'ext-gone'`,
      [tenantId],
    );
    expect(rows[0].status).toBe('inactive');
  });

  it('reactivates previously inactive user', async () => {
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1, 'ext-back', 'back@x', 'Back', 'inactive')`,
      [tenantId],
    );
    const source = mockSource([
      { externalId: 'ext-back', email: 'back@x', displayName: 'Back', active: true },
    ]);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    // reactivation counted as updated in this implementation
    expect(result.updated).toBe(1);
    const { rows } = await adminPool.query(
      `SELECT status FROM users WHERE tenant_id = $1 AND keycloak_sub = 'ext-back'`,
      [tenantId],
    );
    expect(rows[0].status).toBe('active');
  });

  it('skips update when attributes unchanged', async () => {
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1, 'ext-same', 'same@x', 'Same', 'active')`,
      [tenantId],
    );
    const source = mockSource([
      { externalId: 'ext-same', email: 'same@x', displayName: 'Same', active: true },
    ]);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    expect(result.updated).toBe(0);
    expect(result.created).toBe(0);
  });

  it('delta mode does not deactivate missing users', async () => {
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1, 'ext-keep', 'keep@x', 'Keep', 'active')`,
      [tenantId],
    );
    const source: SyncSource = {
      async *fetchAllUsers() { /* not used in delta */ },
      async fetchDeltaUsers() {
        return [{ externalId: 'ext-new', email: 'new@x', displayName: 'New', active: true }];
      },
    };
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'delta');
    expect(result.created).toBe(1);
    expect(result.deactivated).toBe(0);
    const { rows } = await adminPool.query(
      `SELECT status FROM users WHERE tenant_id = $1 AND keycloak_sub = 'ext-keep'`,
      [tenantId],
    );
    expect(rows[0].status).toBe('active');
  });
});
