import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertTableExists } from '../helpers/schema-assertions.js';

describe('assignment', () => {
  let pool: pg.Pool;
  let tenantId: string, userId: string, requestId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('t-asg', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    userId = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'a', 'a@x', 'A') RETURNING id`, [tenantId],
    )).rows[0].id;
    requestId = (await pool.query(
      `INSERT INTO request (tenant_id, created_by_user_id, type, title)
       VALUES ($1,$2,'task','T') RETURNING id`, [tenantId, userId],
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('exists', async () => { await assertTableExists(pool, 'assignment'); });

  it('accepts 8 status values', async () => {
    const statuses = ['unopened','opened','responded','unavailable','forwarded','substituted','exempted','expired'];
    for (const s of statuses) {
      const u = (await pool.query(
        `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
         VALUES ($1, 's-' || $2, 'u-' || $2 || '@x', 'U') RETURNING id`,
        [tenantId, s],
      )).rows[0].id;
      await pool.query(
        `INSERT INTO assignment (tenant_id, request_id, user_id, status)
         VALUES ($1,$2,$3,$4)`, [tenantId, requestId, u, s],
      );
    }
  });

  it('enforces UNIQUE(request_id, user_id)', async () => {
    const u = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'uniq', 'uniq@x', 'U') RETURNING id`, [tenantId],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO assignment (tenant_id, request_id, user_id)
       VALUES ($1,$2,$3)`, [tenantId, requestId, u],
    );
    await expect(
      pool.query(
        `INSERT INTO assignment (tenant_id, request_id, user_id)
         VALUES ($1,$2,$3)`, [tenantId, requestId, u],
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('self-FK forwarded_from_assignment_id', async () => {
    const u1 = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'fwd1', 'f1@x', 'F1') RETURNING id`, [tenantId],
    )).rows[0].id;
    const u2 = (await pool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'fwd2', 'f2@x', 'F2') RETURNING id`, [tenantId],
    )).rows[0].id;
    const orig = (await pool.query(
      `INSERT INTO assignment (tenant_id, request_id, user_id)
       VALUES ($1,$2,$3) RETURNING id`, [tenantId, requestId, u1],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO assignment (tenant_id, request_id, user_id, forwarded_from_assignment_id)
       VALUES ($1,$2,$3,$4)`, [tenantId, requestId, u2, orig],
    );
  });
});
