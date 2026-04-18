import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { getOrgTree } from '../../../../src/domain/org/tree.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('getOrgTree', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('manager sees only orgDiv subtree (not Root, not Sibling)', async () => {
    const s = await createDomainScenario(getPool());
    // manager is in orgDiv; visible = orgDiv + orgTeam (descendants)
    const managerCtx = ctx(s.tenantId, s.users.manager);

    const tree = await getOrgTree(getAppPool(), managerCtx);

    // Collect all IDs in tree
    function collectIds(nodes: typeof tree): string[] {
      return nodes.flatMap((n) => [n.id, ...collectIds(n.children)]);
    }
    const ids = collectIds(tree);

    expect(ids).toContain(s.orgDiv);
    expect(ids).toContain(s.orgTeam);
    expect(ids).not.toContain(s.orgRoot);
    expect(ids).not.toContain(s.orgSibling);

    // orgDiv should be root of the returned tree (no visible parent)
    expect(tree.some((n) => n.id === s.orgDiv)).toBe(true);
  });

  it('tenant_wide_requester sees all orgs', async () => {
    const s = await createDomainScenario(getPool());
    const wideCtx = ctx(s.tenantId, s.users.wideReq, { isTenantWideRequester: true });

    const tree = await getOrgTree(getAppPool(), wideCtx);

    function collectIds(nodes: typeof tree): string[] {
      return nodes.flatMap((n) => [n.id, ...collectIds(n.children)]);
    }
    const ids = collectIds(tree);

    expect(ids).toContain(s.orgRoot);
    expect(ids).toContain(s.orgDiv);
    expect(ids).toContain(s.orgTeam);
    expect(ids).toContain(s.orgSibling);
  });
});
