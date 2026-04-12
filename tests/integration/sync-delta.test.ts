import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import {
  startKeycloak, stopKeycloak, KeycloakSetup,
  kcCreateUser,
} from '../helpers/keycloak-container.js';
import { KeycloakSyncSource } from '../../src/sync/keycloak-source.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';

describe('delta sync integration', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let kc: KeycloakSetup;
  let tenantId: string;
  const redirectUri = 'http://localhost:3999/t/sync-delta/auth/callback';

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    kc = await startKeycloak(redirectUri);
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sync-delta', 'Sync Delta', $1, $2) RETURNING id`,
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

  it('picks up new KC user via admin events', async () => {
    const source = new KeycloakSyncSource(kc.issuerUrl, kc.syncClientId, kc.syncClientSecret);
    await reconcileUsers(appPool, adminPool, tenantId, source, 'full');

    const since = new Date();
    await adminPool.query(
      `UPDATE tenant_sync_config SET last_delta_synced_at = $2 WHERE tenant_id = $1`,
      [tenantId, since],
    );

    // Wait for KC event timestamp
    await new Promise((r) => setTimeout(r, 2000));

    await kcCreateUser(kc, 'delta-user@example.com', 'Delta', 'User');

    await new Promise((r) => setTimeout(r, 2000));

    const deltaResult = await reconcileUsers(appPool, adminPool, tenantId, source, 'delta');
    expect(deltaResult.created).toBeGreaterThanOrEqual(1);

    const { rows } = await adminPool.query(
      `SELECT email FROM users WHERE tenant_id = $1 AND email = 'delta-user@example.com'`,
      [tenantId],
    );
    expect(rows.length).toBe(1);
  }, 120_000);
});
