import 'dotenv/config';
import pg from 'pg';
import format from 'pg-format';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const all = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const done = new Set(rows.map((r) => r.filename));

    for (const filename of all) {
      if (done.has(filename)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
        applied.push(filename);
        console.log(`applied: ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${filename} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return applied;
}

/**
 * Postgres init script は migrate より前に走り、その時点では migration 018 が
 * まだ存在しないため、init script で nudge_app role を操作することはできない。
 * このため migrate 完了後に env から PASSWORD を反映する責務をここで持つ。
 * env 未設定なら no-op（test では pg-container.ts が独自にセットしている）。
 */
export async function setAppRolePasswordFromEnv(pool: pg.Pool): Promise<void> {
  const pw = process.env.NUDGE_APP_PASSWORD;
  if (!pw) return;
  await pool.query(format('ALTER ROLE nudge_app PASSWORD %L', pw));
  console.log('updated nudge_app password from NUDGE_APP_PASSWORD env');
}

// CLI エントリ
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    console.error('DATABASE_URL_ADMIN is required');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  runMigrations(pool)
    .then(async (list) => {
      console.log(`done. ${list.length} migration(s) applied.`);
      await setAppRolePasswordFromEnv(pool);
      return pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      try {
        await pool.end();
      } catch {
        // swallow: we're already in an error path
      }
      process.exit(1);
    });
}
