import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import {
  isManagerOf,
  canSubstitute,
} from '../../../../src/domain/assignment/permissions.js';

describe('assignment permissions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('isManagerOf: manager of orgDiv is manager of memberA (in orgTeam, descendant)', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      isManagerOf(c, s.users.manager, s.users.memberA),
    );
    expect(ok).toBe(true);
  });

  it('isManagerOf: memberB is not manager of memberA', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      isManagerOf(c, s.users.memberB, s.users.memberA),
    );
    expect(ok).toBe(false);
  });

  it('isManagerOf: manager is NOT manager of outsider (different subtree)', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      isManagerOf(c, s.users.manager, s.users.outsider),
    );
    expect(ok).toBe(false);
  });

  it('canSubstitute: requester can substitute assignee', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      canSubstitute(c, { requesterId: s.users.admin, assigneeId: s.users.memberA }, s.users.admin),
    );
    expect(ok).toBe(true);
  });

  it('canSubstitute: manager of assignee can substitute', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      canSubstitute(c, { requesterId: s.users.admin, assigneeId: s.users.memberA }, s.users.manager),
    );
    expect(ok).toBe(true);
  });

  it('canSubstitute: random user cannot substitute', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      canSubstitute(c, { requesterId: s.users.admin, assigneeId: s.users.memberA }, s.users.outsider),
    );
    expect(ok).toBe(false);
  });
});
