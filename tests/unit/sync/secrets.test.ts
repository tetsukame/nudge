import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool } from '../../helpers/pg-container.js';
import {
  getSyncClientSecret,
  setSyncClientSecret,
  hasSyncClientSecret,
} from '../../../src/sync/secrets.js';

async function seedTenantWithSyncConfig(): Promise<string> {
  const pool = getPool();
  const tenantId = randomUUID();
  const tenantCode = `t-${tenantId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO tenant (id, code, name, status, keycloak_realm, keycloak_issuer_url)
     VALUES ($1, $2, 'T', 'active', 'r', 'http://example.com')`,
    [tenantId, tenantCode],
  );
  await pool.query(
    `INSERT INTO tenant_sync_config (tenant_id, enabled, sync_client_id)
     VALUES ($1, true, 'cid')`,
    [tenantId],
  );
  return tenantId;
}

describe('NDG-85: sync_client_secret encrypted storage', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('null when not configured', async () => {
    const id = await seedTenantWithSyncConfig();
    expect(await getSyncClientSecret(getPool(), id)).toBeNull();
    expect(await hasSyncClientSecret(getPool(), id)).toBe(false);
  });

  it('set then get round-trips through AES-256-GCM', async () => {
    const id = await seedTenantWithSyncConfig();
    await setSyncClientSecret(getPool(), id, 'super-secret-value');
    expect(await getSyncClientSecret(getPool(), id)).toBe('super-secret-value');
    expect(await hasSyncClientSecret(getPool(), id)).toBe(true);

    // The plain column should be cleared
    const { rows } = await getPool().query<{
      plain: string | null; enc: string | null;
    }>(
      `SELECT sync_client_secret AS plain, sync_client_secret_encrypted AS enc
         FROM tenant_sync_config WHERE tenant_id = $1`,
      [id],
    );
    expect(rows[0].plain).toBeNull();
    expect(rows[0].enc).toBeTruthy();
    expect(rows[0].enc).not.toContain('super-secret');
  });

  it('lazy migration: plain value read once → re-encrypted and plain cleared', async () => {
    const id = await seedTenantWithSyncConfig();
    // Simulate legacy: write plain value directly
    await getPool().query(
      `UPDATE tenant_sync_config SET sync_client_secret = 'legacy-plain' WHERE tenant_id = $1`,
      [id],
    );

    // First read: decrypts via lazy migration path
    expect(await getSyncClientSecret(getPool(), id)).toBe('legacy-plain');

    // Plain column now NULL, encrypted column populated
    const { rows: r1 } = await getPool().query<{
      plain: string | null; enc: string | null;
    }>(
      `SELECT sync_client_secret AS plain, sync_client_secret_encrypted AS enc
         FROM tenant_sync_config WHERE tenant_id = $1`,
      [id],
    );
    expect(r1[0].plain).toBeNull();
    expect(r1[0].enc).toBeTruthy();

    // Second read returns the same value via decryption (no plain fallback needed)
    expect(await getSyncClientSecret(getPool(), id)).toBe('legacy-plain');
  });

  it('setSyncClientSecret(null) clears both columns', async () => {
    const id = await seedTenantWithSyncConfig();
    await setSyncClientSecret(getPool(), id, 'temp');
    await setSyncClientSecret(getPool(), id, null);
    expect(await getSyncClientSecret(getPool(), id)).toBeNull();
    expect(await hasSyncClientSecret(getPool(), id)).toBe(false);
  });
});
