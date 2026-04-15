import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import { expandTargets, type TargetSpec } from '../../../../src/domain/request/expand-targets.js';

async function mkRequest(pool: import('pg').Pool, tenantId: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','t','active')`,
    [id, tenantId, createdBy],
  );
  return id;
}

describe('expandTargets', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('expands user target to 1 assignment', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'user', userId: s.users.memberA },
      ] satisfies TargetSpec[]);
    });
    expect(breakdown).toEqual({ user: 1, org_unit: 0, group: 0, all: 0 });
  });

  it('expands org_unit with descendants using closure', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'org_unit', orgUnitId: s.orgDiv, includeDescendants: true },
      ]);
    });
    // orgDiv has manager; descendants orgTeam has memberA, memberB => 3 users
    expect(breakdown.org_unit).toBe(3);
  });

  it('expands group target to all members', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'group', groupId: s.groupId },
      ]);
    });
    expect(breakdown.group).toBe(2);
  });

  it('expands all to every active tenant user', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [{ type: 'all' }]);
    });
    expect(breakdown.all).toBe(6);
  });

  it('deduplicates on (request_id, user_id) when user+org overlap', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'user', userId: s.users.memberA },
        { type: 'org_unit', orgUnitId: s.orgTeam, includeDescendants: false },
      ]);
    });
    // memberA inserted twice — ON CONFLICT drops the second; counts reflect raw inserts.
    expect(breakdown.user).toBe(1);
    expect(breakdown.org_unit).toBe(1); // memberB only; memberA conflicts
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    expect(rows[0].n).toBe(2);
  });
});
