# Nudge v0.2 App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v0.1 の DB 層の上に Next.js アプリ基盤（Keycloak OIDC 認証 + テナント解決 + 非 superuser DB 接続 + JIT プロビジョニング）を構築する。

**Architecture:** Next.js App Router + `openid-client`（生 OIDC）+ `iron-session`（暗号化 Cookie）+ 2-プール DB 接続（`adminPool` for migration/tenant lookup, `appPool` for runtime queries enforcing RLS）。中心概念は `middleware.ts` がテナントを解決して認証ガードを行い、OIDC コールバックで JIT upsert してセッションを確立すること。

**Tech Stack:**
- Next.js 15 (App Router, Node runtime, not Edge)
- openid-client 5.x
- iron-session 8.x
- zod (env validation)
- pg (既存)
- vitest + @testcontainers/postgresql (既存) + plain testcontainers (for Keycloak)

**Spec reference:** [2026-04-11-v02-app-foundation-design.md](../specs/2026-04-11-v02-app-foundation-design.md)

---

## File Structure

v0.1 からの変更・追加を明示:

```
package.json                            # 依存追加 + scripts 追加
tsconfig.json                           # Next.js 対応 (jsx, plugins)
next.config.mjs                         # 新規（Node runtime 指定など）
middleware.ts                           # 新規
.env.example                            # 更新（既存を改名・追加）

migrations/
  020_nudge_app_login.sql               # 新規

src/
  config.ts                             # 新規（zod env validator）
  db.ts                                 # 削除（分割）
  db/
    pools.ts                            # 新規（adminPool/appPool factories）
    with-tenant.ts                      # 旧 src/db.ts の withTenant を移動
  migrate.ts                            # 更新（DATABASE_URL → DATABASE_URL_ADMIN）
  tenant/
    resolver.ts                         # 新規
  auth/
    session.ts                          # 新規（seal/unseal wrappers）
    state-cookie.ts                     # 新規
    oidc-client.ts                      # 新規（Issuer + Client factory）
    callback.ts                         # 新規（handleCallback = id_token 検証 + JIT upsert）
    logout.ts                           # 新規（build end_session_url）
  components/
    UserMenu.tsx                        # 新規（ハンバーガー/アバター + dropdown）
    LogoutConfirmModal.tsx              # 新規

app/
  layout.tsx                            # 新規（ルートレイアウト）
  page.tsx                              # 新規（ランディング）
  api/
    health/route.ts                     # 新規
  t/
    [code]/
      layout.tsx                        # 新規（テナント共通レイアウト + UserMenu）
      page.tsx                          # 新規（ダッシュボード placeholder）
      login/route.ts                    # 新規
      auth/callback/route.ts            # 新規
      logout/route.ts                   # 新規
      logged-out/page.tsx               # 新規

tests/
  helpers/
    pg-container.ts                     # 更新（adminPool + nudge_app パスワード設定）
    keycloak-container.ts               # 新規
  rls/
    app-pool-isolation.test.ts          # 新規（appPool 経由の RLS 検証）
  unit/
    tenant/resolver.test.ts             # 新規
    auth/session.test.ts                # 新規
    auth/state-cookie.test.ts           # 新規
    auth/oidc-client.test.ts            # 新規
    auth/callback.test.ts               # 新規
    auth/logout.test.ts                 # 新規
    middleware/guard.test.ts            # 新規
  integration/
    oidc-flow.test.ts                   # 新規（Keycloak testcontainer で E2E）
```

**責任分担:**
- `src/db/pools.ts` — `adminPool()` / `appPool()` のシングルトン管理、接続文字列ロード
- `src/db/with-tenant.ts` — `withTenant(pool, tenantId, fn)`、UUID 検証、`SET LOCAL ROLE nudge_app` も含む
- `src/tenant/resolver.ts` — code → tenant の LRU キャッシュ付き lookup（adminPool 使用）
- `src/auth/session.ts` — `sealSession(data)` / `unsealSession(sealed)` の低レベル関数
- `src/auth/state-cookie.ts` — OIDC 開始時の state/verifier/nonce/returnTo 保存
- `src/auth/oidc-client.ts` — `getIssuer(tenant)` / `getClient(tenant)`、Issuer キャッシュ
- `src/auth/callback.ts` — `handleCallback(...)` = token 交換 + id_token 検証 + JIT upsert
- `src/auth/logout.ts` — `buildEndSessionUrl(tenant, idTokenHint, postLogoutRedirectUri)`
- `middleware.ts` — パス正規化 + テナント解決 + 認証ガード + token refresh
- `app/` 配下の `route.ts` — 上記の関数を薄く呼び出すだけ（ロジックは src/auth に集約）

---

## Task 1: Migration 020 + RLS test via appPool

**Purpose:** `nudge_app` ロールに LOGIN を付与し、appPool 経由で RLS が実際に効くことを検証する。

**Files:**
- Create: `migrations/020_nudge_app_login.sql`
- Modify: `tests/helpers/pg-container.ts` (nudge_app password setup)
- Create: `tests/rls/app-pool-isolation.test.ts`

- [ ] **Step 1: Write failing RLS test using app-pool connection**

Create `tests/rls/app-pool-isolation.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';

/**
 * Verify that RLS is enforced when connecting as nudge_app (non-superuser).
 * This is distinct from tests/rls/tenant-isolation.test.ts which uses
 * SET LOCAL ROLE nudge_app from within a superuser connection.
 */
describe('RLS via appPool (real nudge_app LOGIN connection)', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let t1: string, t2: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    t1 = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('ap-1','T1','r1','https://kc/r1') RETURNING id`,
    )).rows[0].id;
    t2 = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('ap-2','T2','r2','https://kc/r2') RETURNING id`,
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,'s1','a@t1','A'),($2,'s2','b@t2','B')`,
      [t1, t2],
    );
  });
  afterAll(async () => { await stopTestDb(); });

  it('appPool SELECT sees only current tenant rows', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      const { rows } = await client.query(`SELECT email FROM users`);
      expect(rows.map((r) => r.email)).toEqual(['a@t1']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('appPool INSERT with wrong tenant_id is rejected', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${t1}'`);
      await expect(
        client.query(
          `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
           VALUES ($1,'s3','c@t2','C')`,
          [t2],
        ),
      ).rejects.toThrow(/row-level security|new row violates/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm@9.12.0 test tests/rls/app-pool-isolation.test.ts`

Expected: FAIL with either `getAppPool is not exported` or `role "nudge_app" cannot login`.

- [ ] **Step 3: Create migration 020**

Create `migrations/020_nudge_app_login.sql`:

```sql
-- Allow nudge_app to LOGIN. Password is set outside migration (tests + prod).
ALTER ROLE nudge_app LOGIN;
```

- [ ] **Step 4: Update `tests/helpers/pg-container.ts` to set password and create appPool**

Replace the whole file with:

```typescript
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
```

- [ ] **Step 5: Run the failing test again**

Run: `corepack pnpm@9.12.0 test tests/rls/app-pool-isolation.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 6: Run full test suite for regression**

Run: `corepack pnpm@9.12.0 test`

Expected: All existing tests still pass (19 schema + 2 RLS + 2 new RLS = 20 files / 64 tests).

- [ ] **Step 7: Commit**

```bash
git add migrations/020_nudge_app_login.sql tests/helpers/pg-container.ts tests/rls/app-pool-isolation.test.ts
git commit -m "feat(db): grant nudge_app LOGIN and verify RLS via real app connection"
```

---

## Task 2: Split `src/db.ts` into `src/db/pools.ts` + `src/db/with-tenant.ts`

**Purpose:** v0.2 の 2-pool 戦略に向けて、既存の `src/db.ts` を責務ごとに分割する。動作変更なし。

**Files:**
- Delete: `src/db.ts`
- Create: `src/db/pools.ts`
- Create: `src/db/with-tenant.ts`
- Modify: `src/migrate.ts` (no logic change, import unchanged)
- Modify: `tests/helpers/pg-container.ts` (no change needed if it imports from ../../src/migrate.js)

- [ ] **Step 1: Create `src/db/with-tenant.ts` with existing functions**

```typescript
import pg from 'pg';

export type TenantId = string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  pool: pg.Pool,
  tenantId: TenantId,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`invalid tenantId (not a UUID): ${tenantId}`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow
    }
    throw err;
  } finally {
    client.release();
  }
}

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
```

- [ ] **Step 2: Create `src/db/pools.ts`**

```typescript
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

// Re-export legacy createPool for backwards compatibility during the split.
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}
```

- [ ] **Step 3: Delete `src/db.ts`**

```bash
rm c:/work/nudge/src/db.ts
```

- [ ] **Step 4: Update any imports of `src/db.ts` to new paths**

Check for references:
```bash
grep -rn "from.*src/db\"\|from.*src/db'\|from.*\.\./db\"\|from.*\.\./db'" src/ tests/
```

Current imports (before this split): `src/migrate.ts` does NOT import `db.ts` (it imports pg directly), so no change needed in migrate.ts.

If any tests imported from the old `src/db.ts`, update them to:
- `withTenant`, `withBypass`, `TenantId` → `from '../../src/db/with-tenant.js'`
- `createPool` → `from '../../src/db/pools.js'`

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`
Expected: 0 errors.

- [ ] **Step 6: Run full test suite**

Run: `corepack pnpm@9.12.0 test`
Expected: All tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/ src/db.ts
git commit -m "refactor(db): split db.ts into pools and with-tenant modules"
```

Note: the `git add src/db.ts` is to stage the deletion.

---

## Task 3: Rename `DATABASE_URL` → `DATABASE_URL_ADMIN`

**Purpose:** v0.2 で 2 つの接続 URL を持つので、既存の `DATABASE_URL` を `DATABASE_URL_ADMIN` に改名する。

**Files:**
- Modify: `src/migrate.ts` (env var name)
- Modify: `.env.example`
- Modify: `docker-compose.dev.yml` (add comment only, structure unchanged)
- Modify: `tests/helpers/pg-container.ts` already uses container.getConnectionUri() directly, no change needed

- [ ] **Step 1: Update `src/migrate.ts`**

Find the CLI entry block (around line 53):

```typescript
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
```

Replace with:

```typescript
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_ADMIN;
  if (!url) {
    console.error('DATABASE_URL_ADMIN is required');
    process.exit(1);
  }
```

- [ ] **Step 2: Update `.env.example`**

Replace contents with:

```
# Migration and admin access (PostgreSQL superuser or DDL-privileged role)
DATABASE_URL_ADMIN=postgresql://postgres:postgres@localhost:5432/nudge_dev

# Runtime application access (nudge_app LOGIN role, RLS-enforced)
# Set password via: psql $DATABASE_URL_ADMIN -c "ALTER ROLE nudge_app PASSWORD '<secret>'"
DATABASE_URL_APP=postgresql://nudge_app:CHANGE_ME@localhost:5432/nudge_dev

# iron-session encryption key (32+ random chars). Generate with: openssl rand -base64 32
IRON_SESSION_PASSWORD=CHANGE_ME_TO_AT_LEAST_32_CHARS_RANDOM_STRING

# Keycloak OIDC client credentials
OIDC_CLIENT_ID=nudge-web
OIDC_CLIENT_SECRET=CHANGE_ME

# Base URL used to build the redirect_uri (e.g. http://localhost:3000)
# Final redirect_uri becomes: ${OIDC_REDIRECT_URI_BASE}/t/<code>/auth/callback
OIDC_REDIRECT_URI_BASE=http://localhost:3000
```

- [ ] **Step 3: Update `docker-compose.dev.yml` header comment**

Add a comment block at the top of the file:

```yaml
# Local development PostgreSQL for Nudge.
# The service user (nudge) is PostgreSQL superuser in this image, suitable for
# DATABASE_URL_ADMIN (running migrations and schema evolution).
# The application runtime should use DATABASE_URL_APP pointing at the nudge_app
# role (created by migration 018 and granted LOGIN by migration 020).
services:
  postgres:
    ...
```

Keep the rest unchanged.

- [ ] **Step 4: Typecheck and run tests**

```bash
corepack pnpm@9.12.0 typecheck
corepack pnpm@9.12.0 test
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/migrate.ts .env.example docker-compose.dev.yml
git commit -m "chore: rename DATABASE_URL to DATABASE_URL_ADMIN and add DATABASE_URL_APP"
```

---

## Task 4: Install Next.js + add `src/config.ts` (zod env validator)

**Purpose:** Next.js 15 と関連依存を追加、起動時に環境変数を zod で検証する config モジュールを作る。

**Files:**
- Modify: `package.json` (add deps + scripts)
- Create: `next.config.mjs`
- Modify: `tsconfig.json` (jsx + next plugin)
- Create: `src/config.ts`
- Create: `tests/unit/config.test.ts`

- [ ] **Step 1: Update `package.json` dependencies**

Add to `dependencies`:
```json
"next": "^15.0.0",
"react": "^19.0.0",
"react-dom": "^19.0.0",
"openid-client": "^5.7.0",
"iron-session": "^8.0.0",
"zod": "^3.23.0",
"jose": "^5.9.0"
```

Add to `devDependencies`:
```json
"@types/react": "^19.0.0",
"@types/react-dom": "^19.0.0"
```

Update `scripts` section:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "migrate": "tsx src/migrate.ts",
    "test": "vitest run tests/unit tests/schema tests/rls",
    "test:integration": "vitest run tests/integration",
    "test:all": "vitest run",
    "test:watch": "vitest tests/unit",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Install**

Run: `corepack pnpm@9.12.0 install`
Expected: success, pnpm-lock.yaml updated.

- [ ] **Step 3: Create `next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg must not be bundled for server components (native binding)
  // In Next.js 15 this was moved out of `experimental`
  serverExternalPackages: ['pg'],
};

export default nextConfig;
```

- [ ] **Step 4: Update `tsconfig.json`**

Replace contents with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vitest/globals"],
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "app/**/*.ts", "app/**/*.tsx", "tests/**/*.ts", "middleware.ts", "vitest.config.ts", "next.config.mjs", ".next/types/**/*.ts"]
}
```

- [ ] **Step 5: Write failing test for `src/config.ts`**

Create `tests/unit/config.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear env vars under test
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_APP;
    delete process.env.IRON_SESSION_PASSWORD;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI_BASE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const valid = {
    DATABASE_URL_ADMIN: 'postgresql://admin:x@localhost:5432/test',
    DATABASE_URL_APP: 'postgresql://app:x@localhost:5432/test',
    IRON_SESSION_PASSWORD: 'a'.repeat(32),
    OIDC_CLIENT_ID: 'nudge-web',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI_BASE: 'http://localhost:3000',
  };

  it('loads valid config', () => {
    Object.assign(process.env, valid);
    const cfg = loadConfig();
    expect(cfg.DATABASE_URL_ADMIN).toBe(valid.DATABASE_URL_ADMIN);
    expect(cfg.IRON_SESSION_PASSWORD).toBe(valid.IRON_SESSION_PASSWORD);
  });

  it('rejects missing DATABASE_URL_APP', () => {
    Object.assign(process.env, { ...valid, DATABASE_URL_APP: undefined });
    delete process.env.DATABASE_URL_APP;
    expect(() => loadConfig()).toThrow(/DATABASE_URL_APP/);
  });

  it('rejects short IRON_SESSION_PASSWORD', () => {
    Object.assign(process.env, { ...valid, IRON_SESSION_PASSWORD: 'short' });
    expect(() => loadConfig()).toThrow(/IRON_SESSION_PASSWORD/);
  });

  it('rejects invalid OIDC_REDIRECT_URI_BASE', () => {
    Object.assign(process.env, { ...valid, OIDC_REDIRECT_URI_BASE: 'not-a-url' });
    expect(() => loadConfig()).toThrow(/OIDC_REDIRECT_URI_BASE/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `corepack pnpm@9.12.0 test tests/unit/config.test.ts`
Expected: FAIL, `loadConfig` not found.

- [ ] **Step 7: Create `src/config.ts`**

```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL_ADMIN: z.string().url().or(z.string().startsWith('postgresql://')),
  DATABASE_URL_APP: z.string().url().or(z.string().startsWith('postgresql://')),
  IRON_SESSION_PASSWORD: z
    .string()
    .min(32, 'IRON_SESSION_PASSWORD must be at least 32 characters'),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_REDIRECT_URI_BASE: z.string().url(),
});

export type Config = z.infer<typeof ConfigSchema>;

let _cached: Config | undefined;

export function loadConfig(): Config {
  if (_cached) return _cached;
  const parsed = ConfigSchema.safeParse({
    DATABASE_URL_ADMIN: process.env.DATABASE_URL_ADMIN,
    DATABASE_URL_APP: process.env.DATABASE_URL_APP,
    IRON_SESSION_PASSWORD: process.env.IRON_SESSION_PASSWORD,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI_BASE: process.env.OIDC_REDIRECT_URI_BASE,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  _cached = parsed.data;
  return _cached;
}

/**
 * Test helper: reset the cache so tests can change env and re-load.
 */
export function resetConfigCache(): void {
  _cached = undefined;
}
```

Also update the test to call `resetConfigCache()` in `beforeEach` after deleting env vars:

```typescript
import { resetConfigCache, loadConfig } from '../../src/config.js';

beforeEach(() => {
  delete process.env.DATABASE_URL_ADMIN;
  // ... other deletes
  resetConfigCache();
});
```

- [ ] **Step 8: Run test**

Run: `corepack pnpm@9.12.0 test tests/unit/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`
Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.mjs src/config.ts tests/unit/config.test.ts
git commit -m "feat: add Next.js, deps, and zod-validated config module"
```

---

## Task 5: Next.js app skeleton + health endpoint

**Purpose:** 最小のアプリを起動できる状態にする。ルートレイアウト、ランディングページ、ヘルスチェック。

**Files:**
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/api/health/route.ts`

- [ ] **Step 1: Create `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nudge',
  description: '組織内の依頼事項を可視化するタスク管理ツール',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Create `app/page.tsx`**

```tsx
export default function LandingPage() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Nudge</h1>
      <p>組織内の依頼事項を管理するツールです。テナントパス経由でアクセスしてください（例: <code>/t/your-org/</code>）。</p>
    </main>
  );
}
```

- [ ] **Step 3: Create `app/api/health/route.ts`**

```typescript
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() });
}
```

- [ ] **Step 4: Start dev server and verify**

Run: `corepack pnpm@9.12.0 dev`

In another terminal or browser:
- `http://localhost:3000/` → landing page renders
- `http://localhost:3000/api/health` → `{"status":"ok",...}`

Stop the dev server with Ctrl+C.

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`
Expected: 0 errors.

- [ ] **Step 6: Run test suite (regression)**

Run: `corepack pnpm@9.12.0 test`
Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx app/page.tsx app/api/health/route.ts
git commit -m "feat(app): scaffold Next.js app with landing page and health endpoint"
```

---

## Task 6: Tenant resolver with LRU cache

**Purpose:** path prefix からテナントを解決する関数 + キャッシュ。

**Files:**
- Create: `src/tenant/resolver.ts`
- Create: `tests/unit/tenant/resolver.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/tenant/resolver.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../../helpers/pg-container.js';
import { resolveTenant, clearTenantCache, Tenant } from '../../../src/tenant/resolver.js';

describe('tenant resolver', () => {
  let pool: pg.Pool;
  let t1Id: string;

  beforeAll(async () => {
    pool = await startTestDb();
    t1Id = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('acme', 'Acme', 'nudge-acme', 'https://kc/realms/nudge-acme') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => { clearTenantCache(); });

  it('returns tenant by code', async () => {
    const t = await resolveTenant(pool, 'acme');
    expect(t).not.toBeNull();
    expect(t?.id).toBe(t1Id);
    expect(t?.code).toBe('acme');
    expect(t?.keycloakIssuerUrl).toBe('https://kc/realms/nudge-acme');
  });

  it('returns null for unknown code', async () => {
    const t = await resolveTenant(pool, 'unknown');
    expect(t).toBeNull();
  });

  it('caches second lookup (no DB round-trip)', async () => {
    await resolveTenant(pool, 'acme');
    // Delete row but cache should still return it
    await pool.query(`UPDATE tenant SET name = 'Changed' WHERE code = 'acme'`);
    const cached = await resolveTenant(pool, 'acme');
    expect(cached?.name).toBe('Acme'); // still the cached value
  });

  it('clearTenantCache invalidates cache', async () => {
    await resolveTenant(pool, 'acme');
    clearTenantCache();
    const fresh = await resolveTenant(pool, 'acme');
    expect(fresh?.name).toBe('Changed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm@9.12.0 test tests/unit/tenant/resolver.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/tenant/resolver.ts`**

```typescript
import pg from 'pg';

export type Tenant = {
  id: string;
  code: string;
  name: string;
  keycloakRealm: string;
  keycloakIssuerUrl: string;
  status: 'active' | 'suspended';
};

type CacheEntry = {
  value: Tenant | null;
  expiresAt: number;
};

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 100;
const cache = new Map<string, CacheEntry>();

export function clearTenantCache(): void {
  cache.clear();
}

export async function resolveTenant(
  adminPool: pg.Pool,
  code: string,
): Promise<Tenant | null> {
  const now = Date.now();
  const cached = cache.get(code);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const { rows } = await adminPool.query<{
    id: string;
    code: string;
    name: string;
    keycloak_realm: string;
    keycloak_issuer_url: string;
    status: 'active' | 'suspended';
  }>(
    `SELECT id, code, name, keycloak_realm, keycloak_issuer_url, status
     FROM tenant WHERE code = $1`,
    [code],
  );

  const value: Tenant | null = rows[0]
    ? {
        id: rows[0].id,
        code: rows[0].code,
        name: rows[0].name,
        keycloakRealm: rows[0].keycloak_realm,
        keycloakIssuerUrl: rows[0].keycloak_issuer_url,
        status: rows[0].status,
      }
    : null;

  // Simple LRU: if full, drop oldest
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(code, { value, expiresAt: now + TTL_MS });
  return value;
}
```

- [ ] **Step 4: Run test**

Run: `corepack pnpm@9.12.0 test tests/unit/tenant/resolver.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 6: Commit**

```bash
git add src/tenant/resolver.ts tests/unit/tenant/resolver.test.ts
git commit -m "feat(tenant): add tenant resolver with LRU cache"
```

---

## Task 7: Session seal/unseal (iron-session low-level)

**Purpose:** セッションのエンコード/デコードを純粋関数として実装。middleware と route handler の両方から使えるように、iron-session の `sealData`/`unsealData` を薄くラップする。

**Files:**
- Create: `src/auth/session.ts`
- Create: `tests/unit/auth/session.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/auth/session.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import {
  NudgeSession,
  sealSession,
  unsealSession,
} from '../../../src/auth/session.js';

const password = 'a'.repeat(32);
const sample: NudgeSession = {
  userId: '00000000-0000-0000-0000-000000000001',
  tenantId: '00000000-0000-0000-0000-000000000002',
  tenantCode: 'acme',
  sub: 'kc-sub-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  refreshToken: 'refresh_abc',
  accessTokenExp: 1800000000,
};

describe('session seal/unseal', () => {
  it('round-trips a session', async () => {
    const sealed = await sealSession(sample, password);
    expect(typeof sealed).toBe('string');
    expect(sealed.length).toBeGreaterThan(0);
    const unsealed = await unsealSession(sealed, password);
    expect(unsealed).toEqual(sample);
  });

  it('returns null on tampered data', async () => {
    const sealed = await sealSession(sample, password);
    const tampered = sealed.slice(0, -5) + 'XXXXX';
    const unsealed = await unsealSession(tampered, password);
    expect(unsealed).toBeNull();
  });

  it('returns null on empty input', async () => {
    expect(await unsealSession('', password)).toBeNull();
    expect(await unsealSession(undefined, password)).toBeNull();
  });

  it('returns null on wrong password', async () => {
    const sealed = await sealSession(sample, password);
    const unsealed = await unsealSession(sealed, 'b'.repeat(32));
    expect(unsealed).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/session.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/auth/session.ts`**

```typescript
import { sealData, unsealData } from 'iron-session';

export type NudgeSession = {
  userId: string;
  tenantId: string;
  tenantCode: string;
  sub: string;
  email: string;
  displayName: string;
  refreshToken: string;
  accessTokenExp: number;
};

const TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

export async function sealSession(
  session: NudgeSession,
  password: string,
): Promise<string> {
  return sealData(session, { password, ttl: TTL_SECONDS });
}

export async function unsealSession(
  sealed: string | undefined,
  password: string,
): Promise<NudgeSession | null> {
  if (!sealed) return null;
  try {
    const data = await unsealData<NudgeSession>(sealed, { password });
    return data;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/session.ts tests/unit/auth/session.test.ts
git commit -m "feat(auth): add session seal/unseal with iron-session"
```

---

## Task 8: OIDC state cookie (transient)

**Purpose:** ログイン開始時の `state` / `code_verifier` / `nonce` / `returnTo` を短命 cookie に保存するユーティリティ。

**Files:**
- Create: `src/auth/state-cookie.ts`
- Create: `tests/unit/auth/state-cookie.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/auth/state-cookie.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  OidcState,
  sealOidcState,
  unsealOidcState,
} from '../../../src/auth/state-cookie.js';

const password = 'b'.repeat(32);
const sample: OidcState = {
  state: 'random-state-abc',
  codeVerifier: 'random-verifier-xyz',
  nonce: 'random-nonce',
  returnTo: '/dashboard',
};

describe('oidc state cookie', () => {
  it('round-trips state', async () => {
    const sealed = await sealOidcState(sample, password);
    const unsealed = await unsealOidcState(sealed, password);
    expect(unsealed).toEqual(sample);
  });

  it('returns null on missing value', async () => {
    expect(await unsealOidcState(undefined, password)).toBeNull();
  });

  it('returns null on tampered value', async () => {
    const sealed = await sealOidcState(sample, password);
    const bad = sealed.slice(0, -3) + 'zzz';
    expect(await unsealOidcState(bad, password)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/state-cookie.test.ts`

- [ ] **Step 3: Create `src/auth/state-cookie.ts`**

```typescript
import { sealData, unsealData } from 'iron-session';

export type OidcState = {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
};

const TTL_SECONDS = 10 * 60; // 10 minutes

export async function sealOidcState(
  s: OidcState,
  password: string,
): Promise<string> {
  return sealData(s, { password, ttl: TTL_SECONDS });
}

export async function unsealOidcState(
  sealed: string | undefined,
  password: string,
): Promise<OidcState | null> {
  if (!sealed) return null;
  try {
    return await unsealData<OidcState>(sealed, { password });
  } catch {
    return null;
  }
}

export const OIDC_STATE_COOKIE_NAME = 'nudge_oidc_state';
```

- [ ] **Step 4: Run → PASS**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/state-cookie.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/auth/state-cookie.ts tests/unit/auth/state-cookie.test.ts
git commit -m "feat(auth): add oidc state cookie seal/unseal"
```

---

## Task 9: OIDC client factory (Issuer + Client)

**Purpose:** テナントごとに Keycloak Issuer をキャッシュして Client を組み立てる factory。

**Files:**
- Create: `src/auth/oidc-client.ts`
- Create: `tests/unit/auth/oidc-client.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/auth/oidc-client.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Tenant } from '../../../src/tenant/resolver.js';

const tenant: Tenant = {
  id: '00000000-0000-0000-0000-000000000001',
  code: 'acme',
  name: 'Acme',
  keycloakRealm: 'nudge-acme',
  keycloakIssuerUrl: 'https://kc.example.com/realms/nudge-acme',
  status: 'active',
};

// Mock openid-client's Issuer.discover to count calls
vi.mock('openid-client', async () => {
  const actual = await vi.importActual<typeof import('openid-client')>('openid-client');
  return {
    ...actual,
    Issuer: {
      async discover(url: string) {
        discoverCallCount++;
        return new actual.Issuer({
          issuer: url,
          authorization_endpoint: url + '/protocol/openid-connect/auth',
          token_endpoint: url + '/protocol/openid-connect/token',
          end_session_endpoint: url + '/protocol/openid-connect/logout',
          jwks_uri: url + '/protocol/openid-connect/certs',
        });
      },
    },
  };
});

let discoverCallCount = 0;

describe('oidc client factory', () => {
  beforeEach(async () => {
    discoverCallCount = 0;
    const mod = await import('../../../src/auth/oidc-client.js');
    mod.clearIssuerCache();
  });

  it('creates a client for a tenant', async () => {
    const { getOidcClient } = await import('../../../src/auth/oidc-client.js');
    const client = await getOidcClient(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/t/acme/auth/callback',
    });
    expect(client).toBeDefined();
    expect(client.metadata.client_id).toBe('nudge-web');
  });

  it('caches the Issuer across calls for the same tenant', async () => {
    const { getOidcClient } = await import('../../../src/auth/oidc-client.js');
    await getOidcClient(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/t/acme/auth/callback',
    });
    await getOidcClient(tenant, {
      clientId: 'nudge-web',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:3000/t/acme/auth/callback',
    });
    expect(discoverCallCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/oidc-client.test.ts`

- [ ] **Step 3: Create `src/auth/oidc-client.ts`**

```typescript
import { Issuer, Client } from 'openid-client';
import type { Tenant } from '../tenant/resolver.js';

export type OidcClientOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type CacheEntry = {
  issuer: Issuer;
  expiresAt: number;
};

const TTL_MS = 60 * 60 * 1000; // 1 hour
const issuerCache = new Map<string, CacheEntry>();

export function clearIssuerCache(): void {
  issuerCache.clear();
}

async function getIssuer(tenant: Tenant): Promise<Issuer> {
  const now = Date.now();
  const cached = issuerCache.get(tenant.id);
  if (cached && cached.expiresAt > now) {
    return cached.issuer;
  }
  const issuer = await Issuer.discover(tenant.keycloakIssuerUrl);
  issuerCache.set(tenant.id, { issuer, expiresAt: now + TTL_MS });
  return issuer;
}

export async function getOidcClient(
  tenant: Tenant,
  opts: OidcClientOptions,
): Promise<Client> {
  const issuer = await getIssuer(tenant);
  return new issuer.Client({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uris: [opts.redirectUri],
    response_types: ['code'],
  });
}
```

- [ ] **Step 4: Run → PASS**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/oidc-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/oidc-client.ts tests/unit/auth/oidc-client.test.ts
git commit -m "feat(auth): add cached OIDC Issuer and Client factory"
```

---

## Task 10: Callback handler (JIT upsert)

**Purpose:** OIDC コールバックで id_token を検証し、users テーブルに upsert してセッションデータを組み立てる純粋関数。Next.js リクエスト/レスポンスへの紐付けは後続タスクで別途行う。

**Files:**
- Create: `src/auth/callback.ts`
- Create: `tests/unit/auth/callback.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/auth/callback.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run → FAIL**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/callback.test.ts`

- [ ] **Step 3: Create `src/auth/callback.ts`**

```typescript
import pg from 'pg';
import { withTenant } from '../db/with-tenant.js';

export type JitUserInfo = {
  sub: string;
  email: string;
  displayName: string;
};

/**
 * Upsert a user row based on Keycloak id_token claims and return users.id.
 * Runs inside withTenant so RLS / tenant isolation is enforced.
 */
export async function jitUpsertUser(
  pool: pg.Pool,
  tenantId: string,
  info: JitUserInfo,
): Promise<string> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, keycloak_sub)
       DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         updated_at = now()
       RETURNING id`,
      [tenantId, info.sub, info.email, info.displayName],
    );
    return rows[0].id;
  });
}
```

- [ ] **Step 4: Run → PASS**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/callback.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/callback.ts tests/unit/auth/callback.test.ts
git commit -m "feat(auth): add JIT user upsert helper"
```

---

## Task 11: Logout helper (end_session_url builder)

**Files:**
- Create: `src/auth/logout.ts`
- Create: `tests/unit/auth/logout.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/auth/logout.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildEndSessionUrl } from '../../../src/auth/logout.js';

describe('buildEndSessionUrl', () => {
  it('builds URL with required params', () => {
    const url = buildEndSessionUrl({
      endSessionEndpoint: 'https://kc.example.com/realms/acme/protocol/openid-connect/logout',
      idTokenHint: undefined,
      postLogoutRedirectUri: 'http://localhost:3000/t/acme/logged-out',
      clientId: 'nudge-web',
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      'https://kc.example.com/realms/acme/protocol/openid-connect/logout',
    );
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe(
      'http://localhost:3000/t/acme/logged-out',
    );
    expect(u.searchParams.get('client_id')).toBe('nudge-web');
  });

  it('includes id_token_hint if provided', () => {
    const url = buildEndSessionUrl({
      endSessionEndpoint: 'https://kc.example.com/realms/acme/protocol/openid-connect/logout',
      idTokenHint: 'eyJ...',
      postLogoutRedirectUri: 'http://localhost:3000/t/acme/logged-out',
      clientId: 'nudge-web',
    });
    const u = new URL(url);
    expect(u.searchParams.get('id_token_hint')).toBe('eyJ...');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/logout.test.ts`

- [ ] **Step 3: Create `src/auth/logout.ts`**

```typescript
export type EndSessionOptions = {
  endSessionEndpoint: string;
  idTokenHint: string | undefined;
  postLogoutRedirectUri: string;
  clientId: string;
};

/**
 * Build the Keycloak RP-initiated logout URL.
 * See: https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export function buildEndSessionUrl(opts: EndSessionOptions): string {
  const u = new URL(opts.endSessionEndpoint);
  u.searchParams.set('post_logout_redirect_uri', opts.postLogoutRedirectUri);
  u.searchParams.set('client_id', opts.clientId);
  if (opts.idTokenHint) {
    u.searchParams.set('id_token_hint', opts.idTokenHint);
  }
  return u.toString();
}
```

- [ ] **Step 4: Run → PASS**

Run: `corepack pnpm@9.12.0 test tests/unit/auth/logout.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/auth/logout.ts tests/unit/auth/logout.test.ts
git commit -m "feat(auth): add Keycloak end_session URL builder"
```

---

## Task 12: Middleware guard (pure logic function)

**Purpose:** middleware の分岐ロジックを純粋関数として切り出し、単体テスト可能にする。Next.js middleware.ts 本体は次のタスクで薄く wire するだけ。

**Files:**
- Create: `src/auth/middleware-guard.ts`
- Create: `tests/unit/middleware/guard.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/middleware/guard.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { decideRoute, RouteDecision } from '../../../src/auth/middleware-guard.js';

describe('decideRoute', () => {
  const session = {
    userId: 'u1',
    tenantId: 't1',
    tenantCode: 'acme',
    sub: 's',
    email: 'a@x',
    displayName: 'A',
    refreshToken: 'r',
    accessTokenExp: 9999999999,
  };

  it('passes through root', () => {
    const r = decideRoute('/', null, null);
    expect(r.kind).toBe('passthrough');
  });

  it('passes through health', () => {
    const r = decideRoute('/api/health', null, null);
    expect(r.kind).toBe('passthrough');
  });

  it('404s on non-tenant path', () => {
    const r = decideRoute('/random', null, null);
    expect(r.kind).toBe('not_found');
  });

  it('404s on unknown tenant code', () => {
    const r = decideRoute('/t/unknown/dashboard', null, null);
    expect(r.kind).toBe('not_found');
  });

  it('passes through /t/acme/login even without session', () => {
    const r = decideRoute('/t/acme/login', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('passthrough');
  });

  it('passes through /t/acme/auth/callback without session', () => {
    const r = decideRoute('/t/acme/auth/callback', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('passthrough');
  });

  it('passes through /t/acme/logged-out without session', () => {
    const r = decideRoute('/t/acme/logged-out', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('passthrough');
  });

  it('redirects to /t/acme/login when dashboard hit without session', () => {
    const r = decideRoute('/t/acme/dashboard', { id: 't1', code: 'acme' }, null);
    expect(r.kind).toBe('redirect');
    if (r.kind === 'redirect') {
      expect(r.to).toBe('/t/acme/login?returnTo=%2Ft%2Facme%2Fdashboard');
    }
  });

  it('passes through dashboard with matching session', () => {
    const r = decideRoute(
      '/t/acme/dashboard',
      { id: 't1', code: 'acme' },
      session,
    );
    expect(r.kind).toBe('passthrough');
  });

  it('redirects when session tenantId mismatches requested tenant', () => {
    const r = decideRoute(
      '/t/acme/dashboard',
      { id: 't-other', code: 'acme' },
      session,
    );
    expect(r.kind).toBe('redirect');
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `corepack pnpm@9.12.0 test tests/unit/middleware/guard.test.ts`

- [ ] **Step 3: Create `src/auth/middleware-guard.ts`**

```typescript
import type { NudgeSession } from './session.js';

export type TenantRef = { id: string; code: string };

export type RouteDecision =
  | { kind: 'passthrough' }
  | { kind: 'not_found' }
  | { kind: 'redirect'; to: string };

const NO_AUTH_SUFFIXES = new Set(['/login', '/auth/callback', '/logged-out']);

/**
 * Decide what to do with an incoming request based on path, tenant, and session.
 * tenant === null means "the code in the path did not resolve to a tenant".
 */
export function decideRoute(
  path: string,
  tenant: TenantRef | null,
  session: NudgeSession | null,
): RouteDecision {
  if (path === '/') return { kind: 'passthrough' };
  if (path.startsWith('/api/health')) return { kind: 'passthrough' };

  const m = path.match(/^\/t\/([^/]+)(\/.*)?$/);
  if (!m) return { kind: 'not_found' };

  if (tenant === null) return { kind: 'not_found' };

  const rest = m[2] ?? '/';

  if (NO_AUTH_SUFFIXES.has(rest)) return { kind: 'passthrough' };

  // Authenticated path
  if (!session || session.tenantId !== tenant.id) {
    const returnTo = encodeURIComponent(path);
    return {
      kind: 'redirect',
      to: `/t/${tenant.code}/login?returnTo=${returnTo}`,
    };
  }

  return { kind: 'passthrough' };
}
```

- [ ] **Step 4: Run → PASS**

Run: `corepack pnpm@9.12.0 test tests/unit/middleware/guard.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware-guard.ts tests/unit/middleware/guard.test.ts
git commit -m "feat(auth): add middleware route decision pure function"
```

---

## Task 13: `middleware.ts` (wire guard into Next.js)

**Purpose:** Next.js の実 middleware。`decideRoute` を呼んで NextResponse を返すだけ。

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Create `middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from './src/db/pools.js';
import { resolveTenant } from './src/tenant/resolver.js';
import { unsealSession } from './src/auth/session.js';
import { decideRoute } from './src/auth/middleware-guard.js';
import { loadConfig } from './src/config.js';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Resolve tenant if path is /t/<code>/...
  let tenant: { id: string; code: string } | null = null;
  const m = path.match(/^\/t\/([^/]+)/);
  if (m) {
    const resolved = await resolveTenant(adminPool(), m[1]);
    if (resolved) tenant = { id: resolved.id, code: resolved.code };
  }

  // Read session
  const cfg = loadConfig();
  const sealed = request.cookies.get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);

  const decision = decideRoute(path, tenant, session);

  if (decision.kind === 'passthrough') {
    return NextResponse.next();
  }
  if (decision.kind === 'not_found') {
    return new NextResponse('Not Found', { status: 404 });
  }
  // redirect
  const url = new URL(decision.to, request.url);
  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`
Expected: 0 errors. If there are import path errors, adjust the `.js` extensions.

**Note:** The imports from `./src/...` use `.js` extensions because of `moduleResolution: Bundler` + ESM. However, `middleware.ts` lives at repo root, so its relative imports to `src/` need to be correct. If typecheck fails on imports, use absolute imports via the `@/*` alias defined in `tsconfig.json`:

```typescript
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { unsealSession } from '@/auth/session';
import { decideRoute } from '@/auth/middleware-guard';
import { loadConfig } from '@/config';
```

Choose whichever typechecks. Prefer `@/*` aliases.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(app): add Next.js middleware wiring tenant and session guards"
```

---

## Task 14: Login route (`/t/[code]/login/route.ts`)

**Purpose:** OIDC フローの開始。authorizationUrl を組み立てて Keycloak にリダイレクト、state cookie を焼く。

**Files:**
- Create: `app/t/[code]/login/route.ts`

- [ ] **Step 1: Create `app/t/[code]/login/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { generators } from 'openid-client';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getOidcClient } from '@/auth/oidc-client';
import { sealOidcState, OIDC_STATE_COOKIE_NAME } from '@/auth/state-cookie';
import { loadConfig } from '@/config';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) {
    return new NextResponse('Tenant not found', { status: 404 });
  }

  const cfg = loadConfig();
  const redirectUri = `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/auth/callback`;
  const client = await getOidcClient(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    redirectUri,
  });

  const state = generators.state();
  const nonce = generators.nonce();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? `/t/${code}/`;
  // Only allow same-origin, same-tenant return paths
  const safeReturnTo = returnTo.startsWith(`/t/${code}/`) ? returnTo : `/t/${code}/`;

  const sealed = await sealOidcState(
    { state, codeVerifier, nonce, returnTo: safeReturnTo },
    cfg.IRON_SESSION_PASSWORD,
  );

  const authorizationUrl = client.authorizationUrl({
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OIDC_STATE_COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/t/${code}/`,
    maxAge: 10 * 60,
  });
  return response;
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/t/[code]/login/route.ts
git commit -m "feat(app): add OIDC login route"
```

---

## Task 15: Callback route (`/t/[code]/auth/callback/route.ts`)

**Files:**
- Create: `app/t/[code]/auth/callback/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getOidcClient } from '@/auth/oidc-client';
import {
  unsealOidcState,
  OIDC_STATE_COOKIE_NAME,
} from '@/auth/state-cookie';
import { jitUpsertUser } from '@/auth/callback';
import { sealSession, NudgeSession } from '@/auth/session';
import { loadConfig } from '@/config';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 });

  const cfg = loadConfig();
  const sealed = req.cookies.get(OIDC_STATE_COOKIE_NAME)?.value;
  const state = await unsealOidcState(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!state) {
    return new NextResponse('OIDC state expired or missing', { status: 400 });
  }

  const redirectUri = `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/auth/callback`;
  const client = await getOidcClient(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    redirectUri,
  });

  const params2 = client.callbackParams(req.url);
  let tokenSet;
  try {
    tokenSet = await client.callback(redirectUri, params2, {
      state: state.state,
      nonce: state.nonce,
      code_verifier: state.codeVerifier,
    });
  } catch (err) {
    console.error('OIDC callback failed', err);
    return new NextResponse('Authentication failed', { status: 400 });
  }

  const claims = tokenSet.claims();
  const sub = claims.sub;
  const email = (claims.email as string) ?? '';
  const displayName =
    (claims.name as string) ??
    (claims.preferred_username as string) ??
    email;

  const userId = await jitUpsertUser(appPool(), tenant.id, {
    sub,
    email,
    displayName,
  });

  const session: NudgeSession = {
    userId,
    tenantId: tenant.id,
    tenantCode: tenant.code,
    sub,
    email,
    displayName,
    refreshToken: tokenSet.refresh_token ?? '',
    accessTokenExp: tokenSet.expires_at ?? 0,
  };

  const sessionSealed = await sealSession(session, cfg.IRON_SESSION_PASSWORD);

  const response = NextResponse.redirect(
    new URL(state.returnTo, req.url),
  );
  response.cookies.set('nudge_session', sessionSealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/t/${code}/`,
    maxAge: 14 * 24 * 60 * 60,
  });
  // Clear the transient state cookie
  response.cookies.set(OIDC_STATE_COOKIE_NAME, '', {
    path: `/t/${code}/`,
    maxAge: 0,
  });
  return response;
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/t/[code]/auth/callback/route.ts
git commit -m "feat(app): add OIDC callback route with JIT upsert and session"
```

---

## Task 16: Logout route + logged-out page

**Files:**
- Create: `app/t/[code]/logout/route.ts`
- Create: `app/t/[code]/logged-out/page.tsx`

- [ ] **Step 1: Create `app/t/[code]/logout/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { adminPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { getOidcClient } from '@/auth/oidc-client';
import { buildEndSessionUrl } from '@/auth/logout';
import { loadConfig } from '@/config';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 });

  const cfg = loadConfig();
  const redirectUri = `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/auth/callback`;
  const client = await getOidcClient(tenant, {
    clientId: cfg.OIDC_CLIENT_ID,
    clientSecret: cfg.OIDC_CLIENT_SECRET,
    redirectUri,
  });

  const endSessionEndpoint = client.issuer.metadata.end_session_endpoint;
  if (!endSessionEndpoint) {
    return new NextResponse('Keycloak realm has no end_session_endpoint', {
      status: 500,
    });
  }

  const logoutUrl = buildEndSessionUrl({
    endSessionEndpoint,
    idTokenHint: undefined,
    postLogoutRedirectUri: `${cfg.OIDC_REDIRECT_URI_BASE}/t/${code}/logged-out`,
    clientId: cfg.OIDC_CLIENT_ID,
  });

  const response = NextResponse.redirect(logoutUrl);
  // Destroy local session
  response.cookies.set('nudge_session', '', {
    path: `/t/${code}/`,
    maxAge: 0,
  });
  return response;
}
```

- [ ] **Step 2: Create `app/t/[code]/logged-out/page.tsx`**

```tsx
export default async function LoggedOutPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>ログアウトしました</h1>
      <p>
        Nudge と Keycloak 連携中のアプリからログアウトされました。
      </p>
      <p>
        <a href={`/t/${code}/`}>再度ログインする</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 4: Commit**

```bash
git add app/t/[code]/logout/route.ts app/t/[code]/logged-out/page.tsx
git commit -m "feat(app): add logout route and logged-out page"
```

---

## Task 17: Tenant layout + dashboard placeholder + UI components

**Purpose:** テナント配下の共通レイアウトにハンバーガーメニュー + ログアウト確認モーダルを組み込む。ダッシュボードは placeholder で OK。

**Files:**
- Create: `app/t/[code]/layout.tsx`
- Create: `app/t/[code]/page.tsx`
- Create: `src/components/UserMenu.tsx`
- Create: `src/components/LogoutConfirmModal.tsx`

- [ ] **Step 1: Create `src/components/LogoutConfirmModal.tsx`**

```tsx
'use client';

import { useState } from 'react';

type Props = {
  tenantCode: string;
  open: boolean;
  onCancel: () => void;
};

export function LogoutConfirmModal({ tenantCode, open, onCancel }: Props) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: 'white',
          padding: 24,
          borderRadius: 8,
          maxWidth: 480,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      >
        <h2 style={{ marginTop: 0 }}>ログアウトしますか？</h2>
        <p>
          ログアウトすると、Teams や社内ポータルなど SSO 連携中の
          他のアプリからもログアウトされます。続行しますか？
        </p>
        <p style={{ color: '#666', fontSize: '0.9em' }}>
          Nudge だけ非表示にしたい場合は、ブラウザのタブを閉じてください。
          セッションは 14 日間保持されるので、通知から再アクセスすると
          自動で復帰します。
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" onClick={onCancel}>
            キャンセル
          </button>
          <form method="POST" action={`/t/${tenantCode}/logout`} style={{ margin: 0 }}>
            <button type="submit" style={{ background: '#c00', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 4 }}>
              ログアウトする
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/UserMenu.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { LogoutConfirmModal } from './LogoutConfirmModal.js';

type Props = {
  tenantCode: string;
  displayName: string;
};

export function UserMenu({ tenantCode, displayName }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        aria-label="ユーザーメニュー"
        onClick={() => setMenuOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 8,
          fontSize: 20,
        }}
      >
        ☰
      </button>
      {menuOpen && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 4,
            minWidth: 200,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
          }}
        >
          <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
            {displayName}
          </div>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setModalOpen(true);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: 12,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ログアウト
          </button>
        </div>
      )}
      <LogoutConfirmModal
        tenantCode={tenantCode}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create `app/t/[code]/layout.tsx`**

```tsx
import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { UserMenu } from '@/components/UserMenu';

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 24px',
          borderBottom: '1px solid #eee',
        }}
      >
        <div style={{ fontWeight: 'bold' }}>Nudge — {code}</div>
        {session && (
          <UserMenu tenantCode={code} displayName={session.displayName} />
        )}
      </header>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Create `app/t/[code]/page.tsx`**

```tsx
export default async function TenantDashboard({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <div>
      <h1>ダッシュボード</h1>
      <p>
        テナント <strong>{code}</strong> にログインしました。v0.2 では認証基盤のみ実装されています。
      </p>
      <p>依頼機能は v0.4 以降で追加されます。</p>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + test regression**

```bash
corepack pnpm@9.12.0 typecheck
corepack pnpm@9.12.0 test
```

- [ ] **Step 6: Commit**

```bash
git add app/t/[code]/layout.tsx app/t/[code]/page.tsx src/components/UserMenu.tsx src/components/LogoutConfirmModal.tsx
git commit -m "feat(ui): add tenant layout, dashboard placeholder, and logout UI"
```

---

## Task 18: Keycloak testcontainer helper

**Purpose:** Keycloak を testcontainers で起動し、テスト用の realm / client / user を作成するヘルパー。

**Files:**
- Create: `tests/helpers/keycloak-container.ts`

- [ ] **Step 1: Create `tests/helpers/keycloak-container.ts`**

```typescript
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export type KeycloakSetup = {
  container: StartedTestContainer;
  issuerUrl: string;      // e.g. http://localhost:PORT/realms/nudge-test
  realmName: string;
  clientId: string;
  clientSecret: string;
  adminUsername: string;
  adminPassword: string;
  testUserEmail: string;
  testUserPassword: string;
  baseUrl: string;        // e.g. http://localhost:PORT
};

const REALM = 'nudge-test';
const CLIENT_ID = 'nudge-web';
const CLIENT_SECRET = 'test-client-secret';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const TEST_USER = 'alice@example.com';
const TEST_PASS = 'alice-pass';

export async function startKeycloak(redirectUri: string): Promise<KeycloakSetup> {
  const container = await new GenericContainer('quay.io/keycloak/keycloak:26.0')
    .withEnvironment({
      KC_BOOTSTRAP_ADMIN_USERNAME: ADMIN_USER,
      KC_BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASS,
    })
    .withCommand(['start-dev', '--http-port=8080'])
    .withExposedPorts(8080)
    .withWaitStrategy(
      Wait.forHttp('/realms/master/.well-known/openid-configuration', 8080)
        .forStatusCode(200),
    )
    .withStartupTimeout(120_000)
    .start();

  const baseUrl = `http://${container.getHost()}:${container.getMappedPort(8080)}`;

  // Get admin token
  const tokenRes = await fetch(
    `${baseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: ADMIN_USER,
        password: ADMIN_PASS,
      }),
    },
  );
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const authed = (init: RequestInit = {}) => ({
    ...init,
    headers: {
      authorization: `Bearer ${access_token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  // Create realm
  await fetch(`${baseUrl}/admin/realms`, authed({
    method: 'POST',
    body: JSON.stringify({ realm: REALM, enabled: true }),
  }));

  // Create client
  await fetch(`${baseUrl}/admin/realms/${REALM}/clients`, authed({
    method: 'POST',
    body: JSON.stringify({
      clientId: CLIENT_ID,
      secret: CLIENT_SECRET,
      redirectUris: [redirectUri],
      publicClient: false,
      directAccessGrantsEnabled: true,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      protocol: 'openid-connect',
    }),
  }));

  // Create user
  await fetch(`${baseUrl}/admin/realms/${REALM}/users`, authed({
    method: 'POST',
    body: JSON.stringify({
      username: TEST_USER,
      email: TEST_USER,
      firstName: 'Alice',
      lastName: 'Example',
      enabled: true,
      emailVerified: true,
      credentials: [{ type: 'password', value: TEST_PASS, temporary: false }],
    }),
  }));

  return {
    container,
    issuerUrl: `${baseUrl}/realms/${REALM}`,
    realmName: REALM,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    adminUsername: ADMIN_USER,
    adminPassword: ADMIN_PASS,
    testUserEmail: TEST_USER,
    testUserPassword: TEST_PASS,
    baseUrl,
  };
}

export async function stopKeycloak(setup: KeycloakSetup): Promise<void> {
  await setup.container.stop();
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/keycloak-container.ts
git commit -m "test: add Keycloak testcontainer helper"
```

---

## Task 19: Integration test (OIDC flow end-to-end)

**Purpose:** 本物の Keycloak 相手にログインフローを走らせ、`users` に upsert されて session が確立することを確認する。

**Files:**
- Create: `tests/integration/oidc-flow.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { startKeycloak, stopKeycloak, KeycloakSetup } from '../helpers/keycloak-container.js';
import { Issuer } from 'openid-client';
import { jitUpsertUser } from '../../src/auth/callback.js';

/**
 * Minimal E2E: drive an OIDC flow against a real Keycloak, complete token
 * exchange, and verify that jitUpsertUser produces a users row.
 *
 * This test does NOT spin up the Next.js HTTP server. Instead it exercises
 * the same primitives the route handlers use, proving the stack plays well
 * with a real Keycloak without the cost of a full HTTP dance.
 */
describe('OIDC flow integration', () => {
  let adminPool: pg.Pool;
  let kc: KeycloakSetup;
  let tenantId: string;
  const redirectUri = 'http://localhost:3999/t/oidc-test/auth/callback';

  beforeAll(async () => {
    adminPool = await startTestDb();
    kc = await startKeycloak(redirectUri);
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('oidc-test', 'OIDC Test', $1, $2) RETURNING id`,
      [kc.realmName, kc.issuerUrl],
    )).rows[0].id;
  }, 180_000);

  afterAll(async () => {
    await stopKeycloak(kc);
    await stopTestDb();
  }, 60_000);

  it('exchanges password grant for tokens and upserts user', async () => {
    // Use Direct Access Grants to skip the browser redirect step.
    // (We enabled directAccessGrantsEnabled in the Keycloak helper.)
    const tokenResponse = await fetch(
      `${kc.issuerUrl}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: kc.clientId,
          client_secret: kc.clientSecret,
          username: kc.testUserEmail,
          password: kc.testUserPassword,
          scope: 'openid email profile',
        }),
      },
    );
    expect(tokenResponse.ok).toBe(true);
    const tokens = (await tokenResponse.json()) as {
      id_token: string;
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.id_token).toBeTruthy();

    // Verify via openid-client (issuer discovery + JWKS check)
    const issuer = await Issuer.discover(kc.issuerUrl);
    const client = new issuer.Client({
      client_id: kc.clientId,
      client_secret: kc.clientSecret,
    });
    const tokenSet = await client.userinfo(tokens.access_token);
    expect(tokenSet.email).toBe(kc.testUserEmail);

    // JIT upsert
    const appPool = getAppPool();
    const userId = await jitUpsertUser(appPool, tenantId, {
      sub: tokenSet.sub!,
      email: tokenSet.email as string,
      displayName: (tokenSet.name as string) ?? 'Alice',
    });
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);

    // Verify row
    const { rows } = await adminPool.query(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [userId],
    );
    expect(rows[0].email).toBe(kc.testUserEmail);
  }, 120_000);
});
```

- [ ] **Step 2: Run the integration test**

Run: `corepack pnpm@9.12.0 test:integration`

Expected: PASS (1 test). First run takes 60-120 seconds due to KC container pull + startup.

If the test fails:
- Check Docker is running
- Check testcontainers is able to pull `quay.io/keycloak/keycloak:26.0`
- Verify the admin token call succeeds (if not, KC bootstrap env vars may differ by version)

- [ ] **Step 3: Run full test suite**

Run: `corepack pnpm@9.12.0 test:all`
Expected: all unit + schema + RLS + integration tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/oidc-flow.test.ts
git commit -m "test: add end-to-end OIDC flow integration test against Keycloak"
```

---

## Completion Criteria

- [ ] All 19 tasks complete
- [ ] `corepack pnpm@9.12.0 typecheck` clean
- [ ] `corepack pnpm@9.12.0 test` (unit + schema + RLS) all pass
- [ ] `corepack pnpm@9.12.0 test:integration` (Keycloak E2E) passes
- [ ] `corepack pnpm@9.12.0 dev` starts Next.js cleanly
- [ ] Manual browser check: `/`, `/api/health`, `/t/unknown/` (404), `/t/<real>/` (redirect to login)
- [ ] Migration 020 committed, `nudge_app` can LOGIN, RLS effective via appPool

## Scope Recap

Not in v0.2:
- **Token refresh logic**: The session cookie stores `refreshToken` and `accessTokenExp` but v0.2 does NOT implement active refresh. Rationale: v0.2 has no server code that consumes `access_token`, so there is nothing to refresh for. The session cookie itself is independently valid for 14 days via iron-session. When v0.3 starts using `access_token` (e.g., for KC Admin API calls in the sync worker), refresh logic will be added to middleware or a dedicated helper.
- Keycloak Admin API user sync → v0.3
- Org hierarchy sync → v0.3+
- Domain logic (request creation, assignment, transitions) → v0.4+
- Main UI (request list / creation / dashboard) → v0.4+
- Notification worker → v0.5+
