// tests/helpers/fixtures/domain-scenario.ts
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export type DomainScenario = {
  tenantId: string;
  tenantCode: string;
  orgRoot: string;
  orgDiv: string;
  orgTeam: string;
  orgSibling: string;
  users: {
    admin: string;
    wideReq: string;
    manager: string;
    memberA: string;
    memberB: string;
    outsider: string;
  };
  groupId: string;
};

export async function createDomainScenario(pool: pg.Pool): Promise<DomainScenario> {
  const tenantId = randomUUID();
  const tenantCode = 't' + tenantId.slice(0, 6);

  await pool.query(
    `INSERT INTO tenant(id, code, name, keycloak_realm, keycloak_issuer_url)
     VALUES ($1, $2, 'Test', $3, $4)`,
    [tenantId, tenantCode, 'realm-' + tenantCode, 'https://kc.example/realms/' + tenantCode],
  );

  const orgRoot = randomUUID();
  const orgDiv = randomUUID();
  const orgTeam = randomUUID();
  const orgSibling = randomUUID();

  // org_unit requires level (SMALLINT NOT NULL) and has parent_id (nullable)
  // Root=level 0, Division=level 1, Team=level 2, Sibling=level 1
  const orgUnits: Array<[string, string, string | null, number]> = [
    [orgRoot, 'Root', null, 0],
    [orgDiv, 'Division', orgRoot, 1],
    [orgTeam, 'Team', orgDiv, 2],
    [orgSibling, 'Sibling', orgRoot, 1],
  ];
  for (const [id, name, parentId, level] of orgUnits) {
    await pool.query(
      `INSERT INTO org_unit(id, tenant_id, parent_id, name, level) VALUES ($1, $2, $3, $4, $5)`,
      [id, tenantId, parentId, name, level],
    );
  }

  // Closure table: every self-row + every ancestor→descendant row
  const closure: Array<[string, string, number]> = [
    [orgRoot, orgRoot, 0],
    [orgDiv, orgDiv, 0],
    [orgTeam, orgTeam, 0],
    [orgSibling, orgSibling, 0],
    [orgRoot, orgDiv, 1],
    [orgRoot, orgTeam, 2],
    [orgDiv, orgTeam, 1],
    [orgRoot, orgSibling, 1],
  ];
  for (const [anc, desc, depth] of closure) {
    await pool.query(
      `INSERT INTO org_unit_closure(tenant_id, ancestor_id, descendant_id, depth)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, anc, desc, depth],
    );
  }

  async function mkUser(email: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1, $2, $3, $4, $5, 'active')`,
      [id, tenantId, 'kc-' + id, email, email],
    );
    return id;
  }

  const admin = await mkUser('admin@test');
  const wideReq = await mkUser('wide@test');
  const manager = await mkUser('manager@test');
  const memberA = await mkUser('a@test');
  const memberB = await mkUser('b@test');
  const outsider = await mkUser('out@test');

  const memberships: Array<[string, string, boolean]> = [
    [admin, orgRoot, true],
    [wideReq, orgRoot, true],
    [manager, orgDiv, true],
    [memberA, orgTeam, true],
    [memberB, orgTeam, true],
    [outsider, orgSibling, true],
  ];
  for (const [userId, orgId, primary] of memberships) {
    await pool.query(
      `INSERT INTO user_org_unit(tenant_id, user_id, org_unit_id, is_primary)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, userId, orgId, primary],
    );
  }

  await pool.query(
    `INSERT INTO org_unit_manager(tenant_id, org_unit_id, user_id)
     VALUES ($1, $2, $3)`,
    [tenantId, orgDiv, manager],
  );

  await pool.query(
    `INSERT INTO user_role(tenant_id, user_id, role) VALUES ($1, $2, 'tenant_admin')`,
    [tenantId, admin],
  );
  await pool.query(
    `INSERT INTO user_role(tenant_id, user_id, role)
     VALUES ($1, $2, 'tenant_wide_requester')`,
    [tenantId, wideReq],
  );

  const groupId = randomUUID();
  await pool.query(
    `INSERT INTO "group"(id, tenant_id, name, created_by_user_id)
     VALUES ($1, $2, 'TeamAB', $3)`,
    [groupId, tenantId, admin],
  );
  for (const u of [memberA, memberB]) {
    await pool.query(
      `INSERT INTO group_member(tenant_id, group_id, user_id, added_by_user_id)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, groupId, u, admin],
    );
  }

  return {
    tenantId,
    tenantCode,
    orgRoot,
    orgDiv,
    orgTeam,
    orgSibling,
    users: { admin, wideReq, manager, memberA, memberB, outsider },
    groupId,
  };
}
