import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import { emitNotification } from '../../../../src/domain/notification/emit.js';
import { randomUUID } from 'node:crypto';

describe('emitNotification', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('inserts a pending in_app notification for a recipient', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = randomUUID();
    await getPool().query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','t','active')`,
      [reqId, s.tenantId, s.users.admin],
    );
    await withTenant(getAppPool(), s.tenantId, async (client) => {
      await emitNotification(client, {
        tenantId: s.tenantId,
        recipientUserId: s.users.memberA,
        requestId: reqId,
        assignmentId: null,
        kind: 'created',
        payload: { title: 't' },
      });
    });
    const { rows } = await getPool().query(
      `SELECT recipient_user_id, kind, status, channel, payload_json
         FROM notification WHERE request_id=$1`,
      [reqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(s.users.memberA);
    expect(rows[0].kind).toBe('created');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].channel).toBe('in_app');
    expect(rows[0].payload_json).toEqual({ title: 't' });
  });
});
