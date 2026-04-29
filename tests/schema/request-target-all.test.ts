import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { randomUUID } from 'node:crypto';

describe('migration 027: request_target allows target_type=all', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('accepts target_type=all with target_id=NULL', async () => {
    const pool = getPool();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO tenant(id, code, name, keycloak_realm, keycloak_issuer_url) VALUES ($1,$2,$3,'r','https://kc/r')`,
      [tenantId, 't' + tenantId.slice(0, 6), 'T'],
    );
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, tenantId, 'kc-' + userId, 'a@x', 'A'],
    );
    await pool.query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, title, status)
       VALUES ($1,$2,$3,'t','active')`,
      [reqId, tenantId, userId],
    );
    await pool.query(
      `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
       VALUES ($1,$2,'all',NULL)`,
      [tenantId, reqId],
    );
    const { rows } = await pool.query(
      `SELECT target_type, target_id FROM request_target WHERE request_id=$1`,
      [reqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('all');
    expect(rows[0].target_id).toBeNull();
  });

  it('rejects target_type=all with non-NULL target_id', async () => {
    const pool = getPool();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO tenant(id, code, name, keycloak_realm, keycloak_issuer_url) VALUES ($1,$2,$3,'r','https://kc/r')`,
      [tenantId, 't' + tenantId.slice(0, 6), 'T'],
    );
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, tenantId, 'kc-' + userId, 'b@x', 'B'],
    );
    await pool.query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, title, status)
       VALUES ($1,$2,$3,'t','active')`,
      [reqId, tenantId, userId],
    );
    await expect(
      pool.query(
        `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
         VALUES ($1,$2,'all',$3)`,
        [tenantId, reqId, randomUUID()],
      ),
    ).rejects.toThrow(/request_target_target_id_shape/);
  });

  it('rejects non-all types with NULL target_id', async () => {
    const pool = getPool();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO tenant(id, code, name, keycloak_realm, keycloak_issuer_url) VALUES ($1,$2,$3,'r','https://kc/r')`,
      [tenantId, 't' + tenantId.slice(0, 6), 'T'],
    );
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, tenantId, 'kc-' + userId, 'c@x', 'C'],
    );
    await pool.query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, title, status)
       VALUES ($1,$2,$3,'t','active')`,
      [reqId, tenantId, userId],
    );
    await expect(
      pool.query(
        `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
         VALUES ($1,$2,'user',NULL)`,
        [tenantId, reqId],
      ),
    ).rejects.toThrow(/request_target_target_id_shape/);
  });
});
