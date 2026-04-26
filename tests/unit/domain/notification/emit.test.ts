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
    // Default fan-out creates in_app + email rows
    expect(rows).toHaveLength(2);
    const inAppRow = rows.find((r) => r.channel === 'in_app');
    expect(inAppRow).toBeDefined();
    expect(inAppRow!.recipient_user_id).toBe(s.users.memberA);
    expect(inAppRow!.kind).toBe('created');
    expect(inAppRow!.status).toBe('pending');
    expect(inAppRow!.payload_json).toEqual({ title: 't' });
  });

  it('fans out to channels listed in tenant_notification_config (defaults to in_app+email)', async () => {
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
      `SELECT channel FROM notification WHERE request_id=$1 ORDER BY channel`,
      [reqId],
    );
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'in_app']);
  });
});
