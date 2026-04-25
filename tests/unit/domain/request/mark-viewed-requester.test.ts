import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { markViewedByRequester } from '../../../../src/domain/request/mark-viewed-requester.js';
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
): Promise<string> {
  const pool = getPool();
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','view test req','active')`,
    [requestId, s.tenantId, creatorId],
  );
  return requestId;
}

describe('markViewedByRequester', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('sets last_viewed_by_requester_at when actor is requester', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedRequest(s, s.users.admin);

    await markViewedByRequester(getAppPool(), ctx(s, s.users.admin), requestId);

    const { rows } = await getPool().query(
      `SELECT last_viewed_by_requester_at FROM request WHERE id=$1`,
      [requestId],
    );
    expect(rows[0].last_viewed_by_requester_at).not.toBeNull();
  });

  it('no-op (column stays NULL) when actor is not the requester', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedRequest(s, s.users.admin);

    // memberA is NOT the creator of this request
    await markViewedByRequester(getAppPool(), ctx(s, s.users.memberA), requestId);

    const { rows } = await getPool().query(
      `SELECT last_viewed_by_requester_at FROM request WHERE id=$1`,
      [requestId],
    );
    expect(rows[0].last_viewed_by_requester_at).toBeNull();
  });
});
