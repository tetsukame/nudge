import pg from 'pg';

export type TenantId = string;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * テナント境界を強制して実行するユーティリティ。
 * トランザクション内で SET LOCAL app.tenant_id を発行し、
 * fn にクライアントを渡す。
 */
export async function withTenant<T>(
  pool: pg.Pool,
  tenantId: TenantId,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * RLS を無視してテナント横断で実行する管理者向けユーティリティ。
 * migrate、seeds、監視バッチ等で使う。呼び出し側で BYPASSRLS ロールを
 * 使っている前提。
 */
export async function withBypass<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
