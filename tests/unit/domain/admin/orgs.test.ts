import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  listAdminOrgs, createOrg, renameOrg, moveOrg, archiveOrg, restoreOrg,
  AdminOrgError,
} from '../../../../src/domain/admin/orgs.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin, tenantId: s.tenantId,
    isTenantAdmin: true, isTenantWideRequester: false,
  };
}
function plainCtx(s: { tenantId: string; users: { memberA: string } }): ActorContext {
  return {
    userId: s.users.memberA, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false,
  };
}

describe('admin/orgs', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('listAdminOrgs returns all (active + archived) for admin', async () => {
    const s = await createDomainScenario(getPool());
    const items = await listAdminOrgs(getAppPool(), adminCtx(s));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === 'active')).toBe(true);
  });

  it('plain user is denied', async () => {
    const s = await createDomainScenario(getPool());
    await expect(listAdminOrgs(getAppPool(), plainCtx(s)))
      .rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('createOrg creates a manual org with closure rows', async () => {
    const s = await createDomainScenario(getPool());
    const { id } = await createOrg(getAppPool(), adminCtx(s), {
      name: 'Manual', parentId: null,
    });
    const items = await listAdminOrgs(getAppPool(), adminCtx(s));
    const created = items.find((i) => i.id === id);
    expect(created).toBeDefined();
    expect(created?.externalId).toBeNull();
    expect(created?.status).toBe('active');

    // closure: self row
    const { rows } = await getPool().query<{ ok: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM org_unit_closure
          WHERE ancestor_id = $1 AND descendant_id = $1 AND depth = 0
       ) AS ok`, [id],
    );
    expect(rows[0].ok).toBe(true);
  });

  it('createOrg under existing parent inherits level + closure', async () => {
    const s = await createDomainScenario(getPool());
    const { id: child } = await createOrg(getAppPool(), adminCtx(s), {
      name: 'Child', parentId: s.orgRoot,
    });
    const items = await listAdminOrgs(getAppPool(), adminCtx(s));
    const created = items.find((i) => i.id === child);
    expect(created?.level).toBe(1);
    // closure depth 1 from root
    const { rows } = await getPool().query<{ depth: number }>(
      `SELECT depth FROM org_unit_closure WHERE ancestor_id = $1 AND descendant_id = $2`,
      [s.orgRoot, child],
    );
    expect(rows[0]?.depth).toBe(1);
  });

  it('renameOrg works on manual org, fails on KC org', async () => {
    const s = await createDomainScenario(getPool());
    const { id } = await createOrg(getAppPool(), adminCtx(s), { name: 'Rename me', parentId: null });
    await renameOrg(getAppPool(), adminCtx(s), id, 'Renamed');
    const items = await listAdminOrgs(getAppPool(), adminCtx(s));
    expect(items.find((i) => i.id === id)?.name).toBe('Renamed');

    // KC org (with external_id) — pretend by setting external_id directly
    await getPool().query(`UPDATE org_unit SET external_id = 'kc-x' WHERE id = $1`, [s.orgRoot]);
    await expect(renameOrg(getAppPool(), adminCtx(s), s.orgRoot, 'Hijack'))
      .rejects.toMatchObject({ code: 'kc_readonly' });
  });

  it('archiveOrg cascades to descendants (manual orgs only)', async () => {
    const s = await createDomainScenario(getPool());
    const { id: root } = await createOrg(getAppPool(), adminCtx(s), { name: 'Dept', parentId: null });
    const { id: child } = await createOrg(getAppPool(), adminCtx(s), { name: 'Sub', parentId: root });
    const { id: grand } = await createOrg(getAppPool(), adminCtx(s), { name: 'GG', parentId: child });

    const result = await archiveOrg(getAppPool(), adminCtx(s), root);
    expect(result.archivedCount).toBe(3);

    const items = await listAdminOrgs(getAppPool(), adminCtx(s));
    expect(items.find((i) => i.id === root)?.status).toBe('archived');
    expect(items.find((i) => i.id === child)?.status).toBe('archived');
    expect(items.find((i) => i.id === grand)?.status).toBe('archived');
  });

  it('archiveOrg skips KC orgs in cascade', async () => {
    const s = await createDomainScenario(getPool());
    const { id: manualRoot } = await createOrg(getAppPool(), adminCtx(s), { name: 'M', parentId: null });
    // 子に KC org をぶら下げる (移動)
    await getPool().query(`UPDATE org_unit SET external_id = 'kc-y', parent_id = $1 WHERE id = $2`, [manualRoot, s.orgDiv]);
    // closure rebuild
    await getPool().query(`DELETE FROM org_unit_closure WHERE tenant_id = $1`, [s.tenantId]);
    await getPool().query(
      `WITH RECURSIVE tree AS (
         SELECT id, id AS ancestor, 0 AS depth FROM org_unit WHERE tenant_id = $1
         UNION ALL
         SELECT o.id, t.ancestor, t.depth + 1
           FROM org_unit o JOIN tree t ON o.parent_id = t.id WHERE o.tenant_id = $1
       )
       INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
       SELECT $1, ancestor, id, depth FROM tree`, [s.tenantId],
    );

    await archiveOrg(getAppPool(), adminCtx(s), manualRoot);
    const items = await listAdminOrgs(getAppPool(), adminCtx(s));
    expect(items.find((i) => i.id === manualRoot)?.status).toBe('archived');
    // KC 子 (external_id NOT NULL) は active のまま
    expect(items.find((i) => i.id === s.orgDiv)?.status).toBe('active');
  });

  it('restoreOrg reverses archive', async () => {
    const s = await createDomainScenario(getPool());
    const { id } = await createOrg(getAppPool(), adminCtx(s), { name: 'R', parentId: null });
    await archiveOrg(getAppPool(), adminCtx(s), id);
    let items = await listAdminOrgs(getAppPool(), adminCtx(s));
    expect(items.find((i) => i.id === id)?.status).toBe('archived');

    await restoreOrg(getAppPool(), adminCtx(s), id);
    items = await listAdminOrgs(getAppPool(), adminCtx(s));
    expect(items.find((i) => i.id === id)?.status).toBe('active');
  });

  it('moveOrg rejects cycle (new parent is descendant)', async () => {
    const s = await createDomainScenario(getPool());
    const { id: a } = await createOrg(getAppPool(), adminCtx(s), { name: 'A', parentId: null });
    const { id: b } = await createOrg(getAppPool(), adminCtx(s), { name: 'B', parentId: a });
    await expect(moveOrg(getAppPool(), adminCtx(s), a, b))
      .rejects.toMatchObject({ code: 'cycle' });
  });
});
