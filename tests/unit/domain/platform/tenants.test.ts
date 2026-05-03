import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../../../helpers/pg-container.js';
import {
  listTenants, getTenant, createTenant, updateTenant, upsertSyncConfig,
  PlatformTenantError,
} from '../../../../src/domain/platform/tenants.js';

describe('platform/tenants', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creates and lists a tenant', async () => {
    const { id } = await createTenant(getPool(), {
      code: 't-create-1', name: 'T1',
      keycloakRealm: 'r-t-create-1',
      keycloakIssuerUrl: 'https://kc.example.com/realms/r-t-create-1',
    });
    expect(id).toBeDefined();
    const list = await listTenants(getPool());
    expect(list.find((t) => t.id === id)).toBeTruthy();
  });

  it('rejects invalid code', async () => {
    await expect(
      createTenant(getPool(), {
        code: 'X', name: 'bad', keycloakRealm: 'r', keycloakIssuerUrl: 'https://kc/r',
      }),
    ).rejects.toBeInstanceOf(PlatformTenantError);
  });

  it('rejects duplicate code', async () => {
    await createTenant(getPool(), {
      code: 't-dup', name: 'A',
      keycloakRealm: 'r-t-dup', keycloakIssuerUrl: 'https://kc/r-t-dup',
    });
    await expect(
      createTenant(getPool(), {
        code: 't-dup', name: 'B', keycloakRealm: 'r-t-dup-2', keycloakIssuerUrl: 'https://kc/r-t-dup-2',
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('updates name and status', async () => {
    const { id } = await createTenant(getPool(), {
      code: 't-update-1', name: 'orig',
      keycloakRealm: 'r-u-1', keycloakIssuerUrl: 'https://kc/r-u-1',
    });
    await updateTenant(getPool(), id, { name: 'renamed', status: 'suspended' });
    const t = await getTenant(getPool(), id);
    expect(t?.name).toBe('renamed');
    expect(t?.status).toBe('suspended');
  });

  it('upserts sync config and reflects in detail', async () => {
    const { id } = await createTenant(getPool(), {
      code: 't-sync-1', name: 'S1',
      keycloakRealm: 'r-s-1', keycloakIssuerUrl: 'https://kc/r-s-1',
    });
    await upsertSyncConfig(getPool(), id, {
      enabled: true,
      userSourceType: 'keycloak',
      orgSourceType: 'keycloak',
      orgGroupPrefix: '/組織',
      intervalMinutes: 30,
      syncClientId: 'client-id-xyz',
      syncClientSecret: 'secret-xyz',
    });
    const t = await getTenant(getPool(), id);
    expect(t?.syncEnabled).toBe(true);
    expect(t?.syncConfig?.orgSourceType).toBe('keycloak');
    expect(t?.syncConfig?.intervalMinutes).toBe(30);
    expect(t?.syncConfig?.hasClientId).toBe(true);
    expect(t?.syncConfig?.hasClientSecret).toBe(true);
  });
});
