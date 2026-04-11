import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../../src/migrate.js';

let container: StartedPostgreSqlContainer | undefined;
let pool: pg.Pool | undefined;

export async function startTestDb(): Promise<pg.Pool> {
  if (pool) return pool;
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  return pool;
}

export async function stopTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
  if (container) {
    await container.stop();
    container = undefined;
  }
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('test db not started; call startTestDb() first');
  return pool;
}
