import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../src/migrate.js';

const NUDGE_APP_PASSWORD = 'test_nudge_app_password';

let container: StartedPostgreSqlContainer | undefined;
let adminPool: pg.Pool | undefined;
let appPool: pg.Pool | undefined;

export async function startTestDb(): Promise<pg.Pool> {
  if (adminPool) return adminPool;
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const adminUri = container.getConnectionUri();
  adminPool = new pg.Pool({ connectionString: adminUri });
  await runMigrations(adminPool);

  // After migration 020, nudge_app has LOGIN but no password. Set it here.
  await adminPool.query(`ALTER ROLE nudge_app PASSWORD '${NUDGE_APP_PASSWORD}'`);

  // Build app-pool connection string using the testcontainer host/port but nudge_app credentials.
  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const db = container.getDatabase();
  const appUri = `postgresql://nudge_app:${NUDGE_APP_PASSWORD}@${host}:${port}/${db}`;
  appPool = new pg.Pool({ connectionString: appUri });

  return adminPool;
}

export async function stopTestDb(): Promise<void> {
  if (appPool) {
    await appPool.end();
    appPool = undefined;
  }
  if (adminPool) {
    await adminPool.end();
    adminPool = undefined;
  }
  if (container) {
    await container.stop();
    container = undefined;
  }
}

export function getPool(): pg.Pool {
  if (!adminPool) throw new Error('test db not started; call startTestDb() first');
  return adminPool;
}

export function getAppPool(): pg.Pool {
  if (!appPool) throw new Error('test db not started; call startTestDb() first');
  return appPool;
}
