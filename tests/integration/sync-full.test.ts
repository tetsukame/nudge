import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import {
  startKeycloak, stopKeycloak, KeycloakSetup,
  kcCreateUser, kcDeleteUser,
} from '../helpers/keycloak-container.js';
import { KeycloakSyncSource } from '../../src/sync/keycloak-source.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';

describe('full sync integration', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let kc: KeycloakSetup;
  let tenantId: string;
  const redirectUri = 'http://localhost:3999/t/sync-test/auth/callback';

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    kc = await startKeycloak(redirectUri);
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sync-full', 'Sync Full', $1, $2) RETURNING id`,
      [kc.realmName, kc.issuerUrl],
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO tenant_sync_config (tenant_id, enabled, sync_client_id, sync_client_secret)
       VALUES ($1, true, $2, $3)`,
      [tenantId, kc.syncClientId, kc.syncClientSecret],
    );
  }, 180_000);

  afterAll(async () => {
    await stopKeycloak(kc);
    await stopTestDb();
  }, 60_000);

  it('imports KC users to Nudge DB', async () => {
    const bobId = await kcCreateUser(kc, 'bob@example.com', 'Bob', 'Smith');
    const carolId = await kcCreateUser(kc, 'carol@example.com', 'Carol', 'Jones');

    const source = new KeycloakSyncSource(kc.issuerUrl, kc.syncClientId, kc.syncClientSecret);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');

    // At least alice (from startKeycloak) + bob + carol. May include service account users.
    expect(result.created).toBeGreaterThanOrEqual(3);
    expect(result.deactivated).toBe(0);

    const { rows } = await adminPool.query(
      `SELECT email, status FROM users WHERE tenant_id = $1 AND email = 'bob@example.com'`,
      [tenantId],
    );
    expect(rows[0].status).toBe('active');
  }, 120_000);

  it('deactivates deleted KC user on re-sync', async () => {
    const { rows: bobRows } = await adminPool.query(
      `SELECT keycloak_sub FROM users WHERE tenant_id = $1 AND email = 'bob@example.com'`,
      [tenantId],
    );
    if (bobRows[0]) {
      await kcDeleteUser(kc, bobRows[0].keycloak_sub);
    }

    const source = new KeycloakSyncSource(kc.issuerUrl, kc.syncClientId, kc.syncClientSecret);
    const result = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');

    expect(result.deactivated).toBeGreaterThanOrEqual(1);

    const { rows } = await adminPool.query(
      `SELECT status FROM users WHERE tenant_id = $1 AND email = 'bob@example.com'`,
      [tenantId],
    );
    expect(rows[0].status).toBe('inactive');
  }, 120_000);
});
