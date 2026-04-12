import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../../helpers/pg-container.js';
import { resolveTenant, clearTenantCache } from '../../../src/tenant/resolver.js';

describe('tenant resolver', () => {
  let pool: pg.Pool;
  let t1Id: string;

  beforeAll(async () => {
    pool = await startTestDb();
    t1Id = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('acme', 'Acme', 'nudge-acme', 'https://kc/realms/nudge-acme') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => { clearTenantCache(); });

  it('returns tenant by code', async () => {
    const t = await resolveTenant(pool, 'acme');
    expect(t).not.toBeNull();
    expect(t?.id).toBe(t1Id);
    expect(t?.code).toBe('acme');
    expect(t?.keycloakIssuerUrl).toBe('https://kc/realms/nudge-acme');
  });

  it('returns null for unknown code', async () => {
    const t = await resolveTenant(pool, 'unknown');
    expect(t).toBeNull();
  });

  it('caches second lookup (no DB round-trip)', async () => {
    await resolveTenant(pool, 'acme');
    await pool.query(`UPDATE tenant SET name = 'Changed' WHERE code = 'acme'`);
    const cached = await resolveTenant(pool, 'acme');
    expect(cached?.name).toBe('Acme'); // still cached
  });

  it('clearTenantCache invalidates cache', async () => {
    await resolveTenant(pool, 'acme');
    clearTenantCache();
    const fresh = await resolveTenant(pool, 'acme');
    expect(fresh?.name).toBe('Changed');
  });
});
