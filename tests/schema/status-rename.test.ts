import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';

describe('status rename: unavailable → not_needed', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, requestId: string, asgId: string;

  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-rename', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'rn', 'rn@x', 'RN') RETURNING id`, [tenantId],
    )).rows[0].id;
    requestId = (await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, type, title)
       VALUES ($1,$2,'task','T') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    asgId = (await pool.query(
      `INSERT INTO assignment (tenant_id, request_id, user_id)
       VALUES ($1,$2,$3) RETURNING id`, [tenantId, requestId, userId],
    )).rows[0].id;
  });

  afterAll(async () => { await stopTestDb(); });

  it('assignment.status CHECK accepts not_needed', async () => {
    await expect(
      pool.query(
        `UPDATE assignment SET status = 'not_needed' WHERE id = $1`,
        [asgId],
      ),
    ).resolves.toBeDefined();
  });

  it('assignment.status CHECK rejects unavailable', async () => {
    await expect(
      pool.query(
        `UPDATE assignment SET status = 'unavailable' WHERE id = $1`,
        [asgId],
      ),
    ).rejects.toThrow(/check/i);
  });

  it('assignment_status_history transition_kind CHECK accepts user_not_needed', async () => {
    await expect(
      pool.query(
        `INSERT INTO assignment_status_history (tenant_id, assignment_id, to_status, transition_kind)
         VALUES ($1, $2, 'not_needed', 'user_not_needed')`,
        [tenantId, asgId],
      ),
    ).resolves.toBeDefined();
  });

  it('assignment_status_history transition_kind CHECK rejects user_unavailable', async () => {
    await expect(
      pool.query(
        `INSERT INTO assignment_status_history (tenant_id, assignment_id, to_status, transition_kind)
         VALUES ($1, $2, 'not_needed', 'user_unavailable')`,
        [tenantId, asgId],
      ),
    ).rejects.toThrow(/check/i);
  });
});
