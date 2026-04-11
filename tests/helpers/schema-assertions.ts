import pg from 'pg';
import { expect } from 'vitest';

export async function assertTableExists(pool: pg.Pool, name: string): Promise<void> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [name],
  );
  expect(rows[0].exists, `table ${name} should exist`).toBe(true);
}

export async function getColumns(
  pool: pg.Pool,
  table: string,
): Promise<Record<string, { data_type: string; is_nullable: 'YES' | 'NO' }>> {
  const { rows } = await pool.query<{
    column_name: string;
    data_type: string;
    is_nullable: 'YES' | 'NO';
  }>(
    `SELECT column_name, data_type, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return Object.fromEntries(
    rows.map((r) => [r.column_name, { data_type: r.data_type, is_nullable: r.is_nullable }]),
  );
}

export async function assertColumn(
  pool: pg.Pool,
  table: string,
  column: string,
  type: string,
  nullable: boolean,
): Promise<void> {
  const cols = await getColumns(pool, table);
  expect(cols[column], `column ${table}.${column} should exist`).toBeDefined();
  expect(cols[column].data_type).toBe(type);
  expect(cols[column].is_nullable).toBe(nullable ? 'YES' : 'NO');
}

export async function assertIndexExists(
  pool: pg.Pool,
  table: string,
  indexNameLike: string,
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='public' AND tablename=$1 AND indexname LIKE $2`,
    [table, indexNameLike],
  );
  expect(rows.length, `index on ${table} matching ${indexNameLike}`).toBeGreaterThan(0);
}

export async function assertConstraintExists(
  pool: pg.Pool,
  table: string,
  constraintType: 'PRIMARY KEY' | 'UNIQUE' | 'CHECK' | 'FOREIGN KEY',
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema='public' AND table_name=$1 AND constraint_type=$2`,
    [table, constraintType],
  );
  expect(rows.length, `${constraintType} on ${table}`).toBeGreaterThan(0);
}
