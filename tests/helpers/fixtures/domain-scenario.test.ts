import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../pg-container.js';
import { createDomainScenario } from './domain-scenario.js';

describe('domain-scenario fixture', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creates a tenant with full org tree, users, roles, group', async () => {
    const s = await createDomainScenario(getPool());
    const pool = getPool();

    const { rows: users } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE tenant_id=$1`,
      [s.tenantId],
    );
    expect(users[0].n).toBe(6);

    const { rows: orgs } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM org_unit WHERE tenant_id=$1`,
      [s.tenantId],
    );
    expect(orgs[0].n).toBe(4);

    const { rows: mgrs } = await pool.query(
      `SELECT user_id FROM org_unit_manager WHERE tenant_id=$1`,
      [s.tenantId],
    );
    expect(mgrs).toHaveLength(1);
    expect(mgrs[0].user_id).toBe(s.users.manager);

    const { rows: members } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM group_member WHERE tenant_id=$1 AND group_id=$2`,
      [s.tenantId, s.groupId],
    );
    expect(members[0].n).toBe(2);

    // manager covers orgTeam via closure: descendant_id=orgTeam with ancestor_id=orgDiv
    const { rows: closure } = await pool.query(
      `SELECT depth FROM org_unit_closure
        WHERE tenant_id=$1 AND ancestor_id=$2 AND descendant_id=$3`,
      [s.tenantId, s.orgDiv, s.orgTeam],
    );
    expect(closure).toHaveLength(1);
    expect(closure[0].depth).toBe(1);
  });
});
