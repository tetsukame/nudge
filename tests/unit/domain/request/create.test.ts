import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest, CreateRequestError } from '../../../../src/domain/request/create.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin, tenantId: s.tenantId,
    isTenantAdmin: true, isTenantWideRequester: false,
  };
}
function plainCtx(s: { tenantId: string; users: { manager: string } }): ActorContext {
  return {
    userId: s.users.manager, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false,
  };
}

describe('createRequest', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creates request, expands targets, records audit + notifications', async () => {
    const s = await createDomainScenario(getPool());
    const result = await createRequest(getAppPool(), adminCtx(s), {
      title: 'Survey 1',
      body: 'please fill',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'survey',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
      ],
    });
    expect(result.expandedCount).toBe(2);
    expect(result.breakdown.user).toBe(2);

    const { rows: asg } = await getPool().query(
      `SELECT user_id, status FROM assignment WHERE request_id=$1 ORDER BY user_id`,
      [result.id],
    );
    expect(asg.map((r) => r.status)).toEqual(['unopened', 'unopened']);

    const { rows: notif } = await getPool().query(
      `SELECT recipient_user_id FROM notification WHERE request_id=$1 AND channel='in_app'`,
      [result.id],
    );
    expect(notif).toHaveLength(2);

    const { rows: audit } = await getPool().query(
      `SELECT action, target_type, target_id FROM audit_log
        WHERE tenant_id=$1 AND target_id=$2`,
      [s.tenantId, result.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('request.created');
  });

  it('rejects type=all when actor lacks tenant_wide_requester', async () => {
    const s = await createDomainScenario(getPool());
    await expect(
      createRequest(getAppPool(), plainCtx(s), {
        title: 'T', body: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        type: 'task', targets: [{ type: 'all' }],
      }),
    ).rejects.toBeInstanceOf(CreateRequestError);
  });

  it('rejects org_unit target outside visibility for plain user', async () => {
    const s = await createDomainScenario(getPool());
    const { rows } = await getPool().query(
      `SELECT id FROM org_unit WHERE tenant_id=$1 AND name='Sibling'`,
      [s.tenantId],
    );
    const sibling = rows[0].id;
    await expect(
      createRequest(getAppPool(), plainCtx(s), {
        title: 'T', body: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        type: 'task',
        targets: [{ type: 'org_unit', orgUnitId: sibling, includeDescendants: false }],
      }),
    ).rejects.toThrow(/outside visible scope/);
  });

  it('rejects empty-expansion with CreateRequestError', async () => {
    const s = await createDomainScenario(getPool());
    const { rows } = await getPool().query(
      `INSERT INTO "group"(tenant_id, name, created_by_user_id)
       VALUES ($1, 'empty', $2) RETURNING id`,
      [s.tenantId, s.users.admin],
    );
    const emptyGroup = rows[0].id;
    await expect(
      createRequest(getAppPool(), adminCtx(s), {
        title: 'T', body: '',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        type: 'task',
        targets: [{ type: 'group', groupId: emptyGroup }],
      }),
    ).rejects.toThrow(/no targets expanded/);
  });
});
