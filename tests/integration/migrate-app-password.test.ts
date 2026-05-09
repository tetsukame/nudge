// @vitest-environment node
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { setAppRolePasswordFromEnv } from '../../src/migrate.js';

describe('setAppRolePasswordFromEnv', () => {
  let adminPool: pg.Pool;
  const originalPassword = process.env.NUDGE_APP_PASSWORD;

  beforeAll(async () => {
    adminPool = await startTestDb();
  });

  afterAll(async () => {
    if (originalPassword === undefined) {
      delete process.env.NUDGE_APP_PASSWORD;
    } else {
      process.env.NUDGE_APP_PASSWORD = originalPassword;
    }
    await stopTestDb();
  });

  it('is a no-op when NUDGE_APP_PASSWORD is unset', async () => {
    delete process.env.NUDGE_APP_PASSWORD;
    await expect(setAppRolePasswordFromEnv(adminPool)).resolves.toBeUndefined();
  });

  it('sets nudge_app password and allows login with new password', async () => {
    process.env.NUDGE_APP_PASSWORD = 'TestPass-2026!';
    await setAppRolePasswordFromEnv(adminPool);

    const adminUrl = process.env.DATABASE_URL_ADMIN!;
    const url = new URL(adminUrl);
    url.username = 'nudge_app';
    url.password = 'TestPass-2026!';
    const appPool = new pg.Pool({ connectionString: url.toString() });
    try {
      const { rows } = await appPool.query<{ x: number }>('SELECT 1 AS x');
      expect(rows[0].x).toBe(1);
    } finally {
      await appPool.end();
    }
  });

  it('safely escapes passwords containing single quotes', async () => {
    process.env.NUDGE_APP_PASSWORD = "Quote'sPass-2026";
    await setAppRolePasswordFromEnv(adminPool);

    const adminUrl = process.env.DATABASE_URL_ADMIN!;
    const url = new URL(adminUrl);
    url.username = 'nudge_app';
    url.password = "Quote'sPass-2026";
    const appPool = new pg.Pool({ connectionString: url.toString() });
    try {
      const { rows } = await appPool.query<{ x: number }>('SELECT 1 AS x');
      expect(rows[0].x).toBe(1);
    } finally {
      await appPool.end();
    }
  });
});
