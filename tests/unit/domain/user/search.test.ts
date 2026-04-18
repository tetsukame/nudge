import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { searchUsers } from '../../../../src/domain/user/search.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('searchUsers', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('manager finds only users in orgDiv+orgTeam, not outsider', async () => {
    const s = await createDomainScenario(getPool());
    // manager is in orgDiv; visible = orgDiv + orgTeam (descendants)
    // manager@test, a@test, b@test are in those orgs; out@test is in orgSibling
    const managerCtx = ctx(s.tenantId, s.users.manager);

    const results = await searchUsers(getAppPool(), managerCtx, '@test');
    const ids = results.map((r) => r.id);

    expect(ids).toContain(s.users.manager);
    expect(ids).toContain(s.users.memberA);
    expect(ids).toContain(s.users.memberB);
    expect(ids).not.toContain(s.users.outsider);
    // admin and wideReq are in orgRoot which is NOT a descendant of orgDiv
    expect(ids).not.toContain(s.users.admin);
    expect(ids).not.toContain(s.users.wideReq);
  });

  it('tenant_wide_requester finds all 6 users', async () => {
    const s = await createDomainScenario(getPool());
    const wideCtx = ctx(s.tenantId, s.users.wideReq, { isTenantWideRequester: true });

    const results = await searchUsers(getAppPool(), wideCtx, '@test');
    const ids = results.map((r) => r.id);

    expect(ids).toContain(s.users.admin);
    expect(ids).toContain(s.users.wideReq);
    expect(ids).toContain(s.users.manager);
    expect(ids).toContain(s.users.memberA);
    expect(ids).toContain(s.users.memberB);
    expect(ids).toContain(s.users.outsider);
    expect(results.length).toBe(6);
  });

  it('results limited to 20', async () => {
    const s = await createDomainScenario(getPool());
    const wideCtx = ctx(s.tenantId, s.users.wideReq, { isTenantWideRequester: true });

    // Insert 25 extra users
    for (let i = 0; i < 25; i++) {
      await getPool().query(
        `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name, status)
         VALUES (gen_random_uuid(), $1, gen_random_uuid()::text, $2, $3, 'active')`,
        [s.tenantId, `extra${i}@test`, `Extra User ${i}`],
      );
    }

    const results = await searchUsers(getAppPool(), wideCtx, '@test', 20);
    expect(results.length).toBeLessThanOrEqual(20);
  });
});
