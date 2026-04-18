import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { listRequests, ListRequestsError } from '../../../../src/domain/request/list.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(
  tenantId: string, userId: string, opts: Partial<ActorContext> = {},
): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('listRequests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('scope=mine returns requests I created or am assignee of', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    await createRequest(getAppPool(), adminCtx, {
      title: 'R1', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const memberCtx = ctx(s.tenantId, s.users.memberA);
    const result = await listRequests(getAppPool(), memberCtx, { scope: 'mine' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('R1');
  });

  it('scope=subordinate returns requests where assignee is in managed subtree', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    await createRequest(getAppPool(), adminCtx, {
      title: 'R2', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const managerCtx = ctx(s.tenantId, s.users.manager);
    const result = await listRequests(getAppPool(), managerCtx, { scope: 'subordinate' });
    expect(result.items.map((r) => r.title)).toContain('R2');
  });

  it('scope=subordinate for non-manager returns empty (not error)', async () => {
    const s = await createDomainScenario(getPool());
    const memberCtx = ctx(s.tenantId, s.users.memberB);
    const result = await listRequests(getAppPool(), memberCtx, { scope: 'subordinate' });
    expect(result.items).toEqual([]);
  });

  it('scope=all without tenant_wide_requester → error', async () => {
    const s = await createDomainScenario(getPool());
    const memberCtx = ctx(s.tenantId, s.users.memberA);
    await expect(
      listRequests(getAppPool(), memberCtx, { scope: 'all' }),
    ).rejects.toBeInstanceOf(ListRequestsError);
  });

  it('scope=all with tenant_wide_requester returns tenant-wide', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    await createRequest(getAppPool(), adminCtx, {
      title: 'R3', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const wideCtx = ctx(s.tenantId, s.users.wideReq, { isTenantWideRequester: true });
    const result = await listRequests(getAppPool(), wideCtx, { scope: 'all' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects NaN from bad page/pageSize by falling back to defaults', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    // Simulate what the route handler used to pass: NaN
    const result = await listRequests(getAppPool(), adminCtx, {
      scope: 'mine', page: NaN, pageSize: NaN,
    });
    // listRequests internals: Math.max(1, NaN) === NaN — so the domain layer must also guard.
    expect(result.page).toBeGreaterThanOrEqual(1);
    expect(result.pageSize).toBeGreaterThanOrEqual(1);
  });
});
