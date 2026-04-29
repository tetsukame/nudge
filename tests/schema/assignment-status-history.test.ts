import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('assignment_status_history', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, requestId: string, asgId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-hist', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'h', 'h@x', 'H') RETURNING id`, [tenantId],
    )).rows[0].id;
    requestId = (await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, title)
       VALUES ($1,$2,'T') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
    asgId = (await pool.query(
      `INSERT INTO assignment (tenant_id, request_id, user_id)
       VALUES ($1,$2,$3) RETURNING id`, [tenantId, requestId, userId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'assignment_status_history'); });

  it('accepts all transition_kind values', async () => {
    const kinds = ['auto_open','user_respond','user_not_needed','user_forward','manager_substitute','admin_exempt','auto_expire'];
    for (const k of kinds) {
      await pool.query(
        `INSERT INTO assignment_status_history (tenant_id, assignment_id, to_status, transition_kind)
         VALUES ($1,$2,'opened',$3)`, [tenantId, asgId, k],
      );
    }
  });

  it('cascades on assignment delete', async () => {
    const u = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'hc', 'hc@x', 'HC') RETURNING id`, [tenantId],
    )).rows[0].id;
    const a = (await pool.query(
      `INSERT INTO assignment (tenant_id, request_id, user_id)
       VALUES ($1,$2,$3) RETURNING id`, [tenantId, requestId, u],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO assignment_status_history (tenant_id, assignment_id, to_status, transition_kind)
       VALUES ($1,$2,'opened','auto_open')`, [tenantId, a],
    );
    await pool.query(`DELETE FROM assignment WHERE id=$1`, [a]);
    const { rows } = await pool.query(
      `SELECT 1 FROM assignment_status_history WHERE assignment_id=$1`, [a],
    );
    expect(rows.length).toBe(0);
  });
});
