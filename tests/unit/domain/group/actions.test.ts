import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestDb, stopTestDb, getAppPool, getPool,
} from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  createGroup, updateGroup, deleteGroup, addMembers, removeMember, listMembers,
  GroupActionError,
} from '../../../../src/domain/group/actions.js';
import { listGroups, getGroup } from '../../../../src/domain/group/list.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(s: ReturnType<typeof scenarioCtx>['scenario'], userId: string, opts: { isTenantAdmin?: boolean } = {}): ActorContext {
  return {
    userId, tenantId: s.tenantId,
    isTenantAdmin: opts.isTenantAdmin ?? false,
    isTenantWideRequester: false,
  };
}
function scenarioCtx() { return { scenario: null as unknown as Awaited<ReturnType<typeof createDomainScenario>> }; }

describe('group/actions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creator can create / edit / delete a nudge group', async () => {
    const s = await createDomainScenario(getPool());
    const memberCtx = ctx(s, s.users.memberA);

    const { id } = await createGroup(getAppPool(), memberCtx, {
      name: 'study', description: 'まとめ',
    });
    expect(id).toBeDefined();

    await updateGroup(getAppPool(), memberCtx, id, { name: 'study-v2' });
    const got = await getGroup(getAppPool(), memberCtx, id);
    expect(got?.name).toBe('study-v2');

    await deleteGroup(getAppPool(), memberCtx, id);
    const after = await getGroup(getAppPool(), memberCtx, id);
    expect(after).toBeNull();
  });

  it('non-creator non-admin cannot edit', async () => {
    const s = await createDomainScenario(getPool());
    const memberA = ctx(s, s.users.memberA);
    const memberB = ctx(s, s.users.memberB);
    const { id } = await createGroup(getAppPool(), memberA, { name: 'g' });
    await expect(
      updateGroup(getAppPool(), memberB, id, { name: 'hijack' }),
    ).rejects.toBeInstanceOf(GroupActionError);
  });

  it('tenant_admin can edit any nudge group', async () => {
    const s = await createDomainScenario(getPool());
    const memberA = ctx(s, s.users.memberA);
    const adminCtx = ctx(s, s.users.admin, { isTenantAdmin: true });
    const { id } = await createGroup(getAppPool(), memberA, { name: 'g' });
    await updateGroup(getAppPool(), adminCtx, id, { name: 'admin-edit' });
    const got = await getGroup(getAppPool(), adminCtx, id);
    expect(got?.name).toBe('admin-edit');
  });

  it('keycloak-source group is read-only even for tenant_admin', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s, s.users.admin, { isTenantAdmin: true });
    // simulate KC sync by inserting directly
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO "group" (tenant_id, name, created_by_user_id, source)
       VALUES ($1, 'kc-only', $2, 'keycloak') RETURNING id`,
      [s.tenantId, s.users.admin],
    );
    const kcId = rows[0].id;
    await expect(
      updateGroup(getAppPool(), adminCtx, kcId, { name: 'try' }),
    ).rejects.toMatchObject({ code: 'kc_readonly' });
    await expect(
      deleteGroup(getAppPool(), adminCtx, kcId),
    ).rejects.toMatchObject({ code: 'kc_readonly' });
  });

  it('addMembers idempotent + removeMember', async () => {
    const s = await createDomainScenario(getPool());
    const memberA = ctx(s, s.users.memberA);
    const { id } = await createGroup(getAppPool(), memberA, { name: 'g' });

    const res1 = await addMembers(getAppPool(), memberA, id, [s.users.memberB, s.users.outsider]);
    expect(res1.added).toBe(2);

    // 同じユーザーを追加しても増えない (ON CONFLICT)
    const res2 = await addMembers(getAppPool(), memberA, id, [s.users.memberB]);
    expect(res2.added).toBe(0);

    const members = await listMembers(getAppPool(), memberA, id);
    expect(members.map((m) => m.userId).sort()).toEqual(
      [s.users.memberB, s.users.outsider].sort(),
    );

    await removeMember(getAppPool(), memberA, id, s.users.outsider);
    const after = await listMembers(getAppPool(), memberA, id);
    expect(after).toHaveLength(1);
    expect(after[0].userId).toBe(s.users.memberB);
  });

  it('non-member cannot view a group (unless creator/admin)', async () => {
    const s = await createDomainScenario(getPool());
    const memberA = ctx(s, s.users.memberA);
    const memberB = ctx(s, s.users.memberB);
    const { id } = await createGroup(getAppPool(), memberA, { name: 'private' });
    const got = await getGroup(getAppPool(), memberB, id);
    expect(got).toBeNull();
  });

  it('listGroups returns visible groups for actor', async () => {
    const s = await createDomainScenario(getPool());
    const memberA = ctx(s, s.users.memberA);
    const memberB = ctx(s, s.users.memberB);
    const { id: ownGroup } = await createGroup(getAppPool(), memberA, { name: 'own' });
    const { id: hisGroup } = await createGroup(getAppPool(), memberB, { name: 'his' });
    await addMembers(getAppPool(), memberB, hisGroup, [s.users.memberA]);

    const groups = await listGroups(getAppPool(), memberA);
    const ids = groups.map((g) => g.id).sort();
    expect(ids).toContain(ownGroup);
    expect(ids).toContain(hisGroup); // memberA is a member
  });

  it('rejects empty name', async () => {
    const s = await createDomainScenario(getPool());
    const memberA = ctx(s, s.users.memberA);
    await expect(
      createGroup(getAppPool(), memberA, { name: '   ' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
