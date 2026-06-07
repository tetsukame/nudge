import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import {
  getRequestDetail,
  RequestDetailError,
} from '../../../../src/domain/request/get-detail.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(s: { tenantId: string }, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

async function seedRequest(
  s: Awaited<ReturnType<typeof createDomainScenario>>,
  creatorId: string,
  assigneeIds: string[],
): Promise<string> {
  const requestId = randomUUID();
  await getPool().query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, title, status, due_at)
     VALUES ($1, $2, $3, 'detail-test', 'active', now() + interval '1 day')`,
    [requestId, s.tenantId, creatorId],
  );
  for (const userId of assigneeIds) {
    await getPool().query(
      `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1, $2, $3)`,
      [s.tenantId, requestId, userId],
    );
  }
  return requestId;
}

describe('NDG-93 (E7): getRequestDetail', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('throws not_found when request id does not exist', async () => {
    const s = await createDomainScenario(getPool());
    await expect(
      getRequestDetail(getAppPool(), ctx(s, s.users.admin), randomUUID()),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('creator can read; returns title and status', async () => {
    const s = await createDomainScenario(getPool());
    const id = await seedRequest(s, s.users.wideReq, [s.users.memberA]);
    const detail = await getRequestDetail(getAppPool(), ctx(s, s.users.wideReq), id);
    expect(detail.id).toBe(id);
    expect(detail.title).toBe('detail-test');
    expect(detail.status).toBe('active');
    expect(detail.myAssignment).toBeNull();
  });

  it('assignee can read; myAssignment is populated', async () => {
    const s = await createDomainScenario(getPool());
    const id = await seedRequest(s, s.users.wideReq, [s.users.memberA]);
    const detail = await getRequestDetail(getAppPool(), ctx(s, s.users.memberA), id);
    expect(detail.myAssignment?.status).toBe('unopened');
    expect(detail.myAssignment?.isOverdue).toBe(false);
  });

  it('tenant_admin can read any', async () => {
    const s = await createDomainScenario(getPool());
    const id = await seedRequest(s, s.users.wideReq, [s.users.memberA]);
    const detail = await getRequestDetail(
      getAppPool(), ctx(s, s.users.outsider, { isTenantAdmin: true }), id,
    );
    expect(detail.id).toBe(id);
  });

  it('outsider (not creator/assignee/wide/manager) is denied with permission_denied', async () => {
    const s = await createDomainScenario(getPool());
    const id = await seedRequest(s, s.users.wideReq, [s.users.memberA]);
    await expect(
      getRequestDetail(getAppPool(), ctx(s, s.users.outsider), id),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('error is instance of RequestDetailError', async () => {
    const s = await createDomainScenario(getPool());
    let caught: unknown = null;
    try {
      await getRequestDetail(getAppPool(), ctx(s, s.users.admin), randomUUID());
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(RequestDetailError);
  });
});
