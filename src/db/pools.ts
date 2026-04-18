import pg from 'pg';

let _adminPool: pg.Pool | undefined;
let _appPool: pg.Pool | undefined;

export function adminPool(): pg.Pool {
  if (!_adminPool) {
    const url = process.env.DATABASE_URL_ADMIN;
    if (!url) throw new Error('DATABASE_URL_ADMIN is not set');
    _adminPool = new pg.Pool({ connectionString: url, max: 5 });
  }
  return _adminPool;
}

export function appPool(): pg.Pool {
  if (!_appPool) {
    const url = process.env.DATABASE_URL_APP;
    if (!url) throw new Error('DATABASE_URL_APP is not set');
    _appPool = new pg.Pool({ connectionString: url, max: 10 });
  }
  return _appPool;
}

/**
 * Close all pools. Intended for graceful shutdown and tests.
 */
export async function closePools(): Promise<void> {
  if (_adminPool) {
    await _adminPool.end();
    _adminPool = undefined;
  }
  if (_appPool) {
    await _appPool.end();
    _appPool = undefined;
  }
}

// Legacy createPool for backwards compat during the split.
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/**
 * Reset cached pool singletons. Intended for tests that spin up a fresh
 * database container and need the production singletons to re-initialize
 * against the new connection strings.
 */
export function resetPools(): void {
  _adminPool = undefined;
  _appPool = undefined;
}
