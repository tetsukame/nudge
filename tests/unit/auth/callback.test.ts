import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../../helpers/pg-container.js';
import { jitUpsertUser } from '../../../src/auth/callback.js';

describe('jitUpsertUser', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('cb','CB','r','https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await adminPool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
  });

  it('inserts new user', async () => {
    const userId = await jitUpsertUser(appPool, tenantId, {
      sub: 'kc-sub-1',
      email: 'alice@example.com',
      displayName: 'Alice',
    });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await adminPool.query(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [userId],
    );
    expect(rows[0].email).toBe('alice@example.com');
    expect(rows[0].display_name).toBe('Alice');
  });

  it('updates existing user on subsequent login', async () => {
    const first = await jitUpsertUser(appPool, tenantId, {
      sub: 'kc-sub-2',
      email: 'bob@old.example',
      displayName: 'Bob',
    });
    const second = await jitUpsertUser(appPool, tenantId, {
      sub: 'kc-sub-2',
      email: 'bob@new.example',
      displayName: 'Bobby',
    });
    expect(second).toBe(first);
    const { rows } = await adminPool.query(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [first],
    );
    expect(rows[0].email).toBe('bob@new.example');
    expect(rows[0].display_name).toBe('Bobby');
  });

  it('isolates users across tenants with same sub', async () => {
    const other = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('cb2','CB2','r','https://kc/r') RETURNING id`,
    )).rows[0].id;
    const u1 = await jitUpsertUser(appPool, tenantId, {
      sub: 'shared-sub',
      email: 'x@a',
      displayName: 'X',
    });
    const u2 = await jitUpsertUser(appPool, other, {
      sub: 'shared-sub',
      email: 'x@b',
      displayName: 'X2',
    });
    expect(u1).not.toBe(u2);
  });
});
