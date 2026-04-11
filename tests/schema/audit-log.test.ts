import { afterAll, beforeAll, describe, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('audit_log', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-al', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'al', 'al@x', 'AL') RETURNING id`, [tenantId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'audit_log'); });

  it('accepts user-actor and system (null actor) rows', async () => {
    await pool.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, target_type, target_id)
       VALUES ($1,$2,'group.created','group',$3)`,
      [tenantId, userId, '00000000-0000-0000-0000-000000000009'],
    );
    await pool.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, target_type, target_id)
       VALUES ($1,NULL,'assignment.auto_expire','assignment',$2)`,
      [tenantId, '00000000-0000-0000-0000-00000000000a'],
    );
  });

  it('accepts JSONB payload and INET ip', async () => {
    await pool.query(
      `INSERT INTO audit_log (tenant_id, actor_user_id, action, target_type, target_id, payload_json, ip_address)
       VALUES ($1,$2,'role.granted','user',$2,$3::jsonb,'192.0.2.1'::inet)`,
      [tenantId, userId, JSON.stringify({ role: 'tenant_admin' })],
    );
  });
});
