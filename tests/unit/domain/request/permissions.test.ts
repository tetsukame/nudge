import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import {
  canTargetOutsideScope,
  getVisibleOrgUnitIds,
} from '../../../../src/domain/request/permissions.js';

describe('request permissions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('canTargetOutsideScope: true for tenant_wide_requester', () => {
    expect(canTargetOutsideScope({
      userId: 'u', tenantId: 't',
      isTenantAdmin: false, isTenantWideRequester: true,
    })).toBe(true);
  });

  it('canTargetOutsideScope: true for tenant_admin', () => {
    expect(canTargetOutsideScope({
      userId: 'u', tenantId: 't',
      isTenantAdmin: true, isTenantWideRequester: false,
    })).toBe(true);
  });

  it('canTargetOutsideScope: false for plain user', () => {
    expect(canTargetOutsideScope({
      userId: 'u', tenantId: 't',
      isTenantAdmin: false, isTenantWideRequester: false,
    })).toBe(false);
  });

  it('getVisibleOrgUnitIds returns self + descendants of user orgs', async () => {
    const pool = getPool();
    const s = await createDomainScenario(pool);
    const visible = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return getVisibleOrgUnitIds(client, s.users.manager);
    });
    // manager is in orgDiv; visible = orgDiv (self) + orgTeam (descendant)
    // orgRoot is an ancestor, not visible per spec.
    expect(visible.sort()).toEqual([s.orgDiv, s.orgTeam].sort());
  });
});
