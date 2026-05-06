# v0.16 OSS Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `git clone && docker compose up` で web + worker + PostgreSQL + Keycloak + MailHog が起動し、3 つの手動コマンドだけでログイン画面まで到達できる OSS デモ用配布構成を実装する。

**Architecture:** 単一 Dockerfile (multi-stage 2 段) で web/worker/migrate を共有イメージ化、tsx を runtime dependencies に置いて TypeScript 直接実行。3 つの compose ファイル（full / byo-kc / dev）で起動モードを切り替え。Keycloak は `start-dev --import-realm` で nudge realm を起動時に自動 import。

**Tech Stack:** Docker, Docker Compose v2, Node.js 20-alpine, PostgreSQL 17-alpine, Keycloak 26, tsx, pg-format

**Spec:** [docs/superpowers/specs/2026-05-05-v016-oss-distribution-design.md](../specs/2026-05-05-v016-oss-distribution-design.md)

**Branch:** `feat/v016-docker-compose`

---

## File Structure

新規作成：

| パス | 役割 |
|---|---|
| `Dockerfile` | Multi-stage build (builder + runner) |
| `.dockerignore` | ビルドコンテキスト除外設定 |
| `docker-compose.yml` | OSS デモ用フルスタック（KC 同梱） |
| `docker-compose.byo-kc.yml` | Bring Your Own Keycloak モード |
| `docker/keycloak/nudge-realm.json` | KC realm 定義 |
| `tests/integration/migrate-app-password.test.ts` | nudge_app パスワード設定の統合テスト |

修正：

| パス | 修正内容 |
|---|---|
| `package.json` | `tsx` を devDependencies → dependencies、`pg-format` + `@types/pg-format` を追加 |
| `src/migrate.ts` | 末尾に `setAppRolePasswordFromEnv` 関数追加、CLI から呼び出し |
| `README.md` | OSS デモ起動手順 + byo-kc モード手順を追加 |

---

## Task 1: Branch creation + dependencies

**Files:**
- Create branch: `feat/v016-docker-compose`
- Modify: `package.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout main && git pull
git checkout -b feat/v016-docker-compose
```

- [ ] **Step 2: Move tsx to dependencies, add pg-format**

Edit `package.json`:
- Move `"tsx": "^4.19.0"` from `devDependencies` to `dependencies`
- Add to `dependencies`: `"pg-format": "^1.0.4"`
- Add to `devDependencies`: `"@types/pg-format": "^1.0.5"`

Final relevant excerpt:
```json
"dependencies": {
  ...
  "pg-format": "^1.0.4",
  "pg": "^8.13.0",
  ...
  "tsx": "^4.19.0",
  ...
},
"devDependencies": {
  ...
  "@types/pg-format": "^1.0.5",
  "@types/pg": "^8.11.10",
  ...
  // tsx removed from here
}
```

- [ ] **Step 3: Install**

```bash
pnpm install
```

Expected: lockfile updated, no errors. New deps in `node_modules/pg-format/` and `node_modules/@types/pg-format/`.

- [ ] **Step 4: Verify typecheck still clean**

```bash
pnpm typecheck
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(v0.16): move tsx to deps, add pg-format

Phase 5b の Docker 化で worker/migrate を tsx で実行するため
production dependencies に tsx を昇格。pg-format は migrate.ts の
nudge_app パスワード設定 (ALTER ROLE) 用。"
```

---

## Task 2: migrate.ts に NUDGE_APP_PASSWORD 反映処理を追加

**Files:**
- Test: `tests/integration/migrate-app-password.test.ts`
- Modify: `src/migrate.ts`

- [ ] **Step 1: Write failing integration test**

Create `tests/integration/migrate-app-password.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { runMigrations, setAppRolePasswordFromEnv } from '../../src/migrate';

describe('setAppRolePasswordFromEnv', () => {
  let adminPool: pg.Pool;

  beforeAll(async () => {
    adminPool = await startTestDb();
    await runMigrations(adminPool);
  });

  afterAll(async () => {
    delete process.env.NUDGE_APP_PASSWORD;
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test:integration tests/integration/migrate-app-password.test.ts
```

Expected: FAIL with `setAppRolePasswordFromEnv is not exported` or similar.

- [ ] **Step 3: Add `setAppRolePasswordFromEnv` to migrate.ts**

Modify `src/migrate.ts`. Add import at top:

```typescript
import format from 'pg-format';
```

Add new exported function after `runMigrations`:

```typescript
/**
 * Apply NUDGE_APP_PASSWORD env var to nudge_app role.
 *
 * Postgres init scripts run before migrations, so nudge_app role doesn't exist
 * yet at that point. We set the password here, after migration 018 has created
 * the role. No-op if env var is unset (e.g., in tests that handle this manually).
 *
 * Uses pg-format because PostgreSQL doesn't accept bind parameters in
 * ALTER ROLE PASSWORD; we must interpolate as a literal with proper escaping.
 */
export async function setAppRolePasswordFromEnv(pool: pg.Pool): Promise<void> {
  const pw = process.env.NUDGE_APP_PASSWORD;
  if (!pw) return;
  await pool.query(format('ALTER ROLE nudge_app PASSWORD %L', pw));
  console.log('updated nudge_app password from NUDGE_APP_PASSWORD env');
}
```

Update CLI section to call it:

```typescript
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
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm test:integration tests/integration/migrate-app-password.test.ts
```

Expected: PASS, 3/3 tests.

- [ ] **Step 5: Run full test suite to verify no regression**

```bash
pnpm typecheck && pnpm test
```

Expected: typecheck clean, 298+ unit tests pass (one new integration test).

- [ ] **Step 6: Commit**

```bash
git add src/migrate.ts tests/integration/migrate-app-password.test.ts
git commit -m "feat(v0.16): apply NUDGE_APP_PASSWORD env to nudge_app role after migrate

Docker Compose 環境でマイグレーション完了後に nudge_app の
パスワードを env から自動設定するための処理。Postgres init
script は migrate より前に走るため migration 018 で作成される
nudge_app role を init script では操作できない。pg-format で
SQL injection を防ぎつつ ALTER ROLE PASSWORD を発行。"
```

---

## Task 3: .dockerignore + Dockerfile

**Files:**
- Create: `.dockerignore`
- Create: `Dockerfile`

- [ ] **Step 1: Create .dockerignore**

Create `.dockerignore`:

```
# VCS / CI
.git
.gitignore
.github

# IDE / editor
.vscode
.idea
.claude
.superpowers

# Local env files (must NOT be in image)
.env
.env.local
.env.*.local

# Build artifacts (will be rebuilt in image)
node_modules
.next
dist
tsconfig.tsbuildinfo

# Logs and OS files
*.log
.DS_Store
Thumbs.db

# Tests / docs / dev compose (not needed in production image)
tests
docs
docker-compose.dev.yml

# Local Docker compose data
data
```

- [ ] **Step 2: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7

# ----------------------------------------------------------------------------
# Stage 1: builder
# Install deps + run Next.js production build
# ----------------------------------------------------------------------------
FROM node:20-alpine AS builder

# Enable pnpm via corepack
RUN corepack enable

WORKDIR /app

# Cache dependency layer
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ----------------------------------------------------------------------------
# Stage 2: runner
# Production deps only + Next.js build artifacts + source for tsx
# ----------------------------------------------------------------------------
FROM node:20-alpine AS runner

RUN corepack enable

WORKDIR /app

ENV NODE_ENV=production

# Install production deps (includes tsx and pg-format moved to deps)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Next.js build outputs
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./

# Source files needed at runtime by tsx (worker / migrate / scripts)
# and by Next.js server (middleware, app router uses src/ paths)
COPY src ./src
COPY app ./app
COPY middleware.ts ./middleware.ts

# SQL migrations
COPY migrations ./migrations

EXPOSE 3000

CMD ["pnpm", "start"]
```

- [ ] **Step 3: Build image to verify**

```bash
docker build -t nudge:v0.16-test .
```

Expected: build succeeds. Note image size with `docker images nudge:v0.16-test` (should be ~250-300MB).

- [ ] **Step 4: Verify web command runs**

```bash
docker run --rm -e DATABASE_URL_ADMIN=postgresql://x:y@unreachable/db \
  -e DATABASE_URL_APP=postgresql://x:y@unreachable/db \
  -e IRON_SESSION_PASSWORD=test-pass-32-chars-minimum-aaaaaaaa \
  -e OIDC_CLIENT_ID=test \
  -e OIDC_CLIENT_SECRET=test \
  -e OIDC_REDIRECT_URI_BASE=http://localhost:3000 \
  --entrypoint sh nudge:v0.16-test \
  -c "ls -la .next/ src/migrate.ts && which tsx"
```

Expected: `.next/` dir exists, `src/migrate.ts` exists, `tsx` resolves to `/app/node_modules/.bin/tsx`.

- [ ] **Step 5: Commit**

```bash
git add .dockerignore Dockerfile
git commit -m "feat(v0.16): add Dockerfile (multi-stage builder + runner)

Single image runs web (npm start), worker (pnpm worker), and
migrate (pnpm migrate). tsx is in production deps so TS source
runs directly without compilation. .dockerignore excludes tests/,
docs/, .env, and dev-only files."
```

---

## Task 4: Keycloak realm definition

**Files:**
- Create: `docker/keycloak/nudge-realm.json`

- [ ] **Step 1: Create directory and realm file**

```bash
mkdir -p docker/keycloak
```

Create `docker/keycloak/nudge-realm.json`:

```json
{
  "realm": "nudge",
  "displayName": "Nudge",
  "enabled": true,
  "registrationAllowed": false,
  "loginWithEmailAllowed": true,
  "duplicateEmailsAllowed": false,
  "resetPasswordAllowed": true,
  "editUsernameAllowed": false,
  "bruteForceProtected": true,
  "accessTokenLifespan": 300,
  "ssoSessionIdleTimeout": 1800,
  "ssoSessionMaxLifespan": 36000,
  "clients": [
    {
      "clientId": "nudge-web",
      "name": "Nudge Web",
      "enabled": true,
      "publicClient": false,
      "secret": "nudge-demo-client-secret-change-me",
      "standardFlowEnabled": true,
      "directAccessGrantsEnabled": false,
      "implicitFlowEnabled": false,
      "serviceAccountsEnabled": true,
      "redirectUris": ["http://localhost:3000/t/*/auth/callback"],
      "webOrigins": ["http://localhost:3000"],
      "attributes": {
        "post.logout.redirect.uris": "http://localhost:3000/*"
      },
      "defaultClientScopes": ["email", "profile", "roles"],
      "optionalClientScopes": []
    }
  ],
  "groups": [],
  "users": []
}
```

**Important note on the secret value**: Keycloak's `--import-realm` does **not** perform env var substitution on the JSON file itself (substitution applies to KC's own config, not import data). So we use a literal `"nudge-demo-client-secret-change-me"` here, and the same value is used as the default for `OIDC_CLIENT_SECRET` in `docker-compose.yml`. README warns that this is for demo only and instructs users to override `OIDC_CLIENT_SECRET` in `.env` (and re-import realm or update via `kcadm.sh`) for production-like usage.

For `nudge-web` client to receive the role bindings needed by service accounts (sync API), additional `service-account-client-roles` setup is required. We document this as a manual step in README and revisit in Phase 5e.

- [ ] **Step 2: Verify JSON validity**

```bash
node -e "JSON.parse(require('fs').readFileSync('docker/keycloak/nudge-realm.json', 'utf8'))"
```

Expected: no output (valid JSON).

- [ ] **Step 3: Commit**

```bash
git add docker/keycloak/nudge-realm.json
git commit -m "feat(v0.16): add Keycloak realm definition for OSS demo

Minimal realm with nudge-web client (confidential, standard flow).
\${OIDC_CLIENT_SECRET} placeholder substituted via KC env var
import. Users / groups / orgs are NOT included; manual creation
documented in README per Phase 5b semi-auto scope."
```

---

## Task 5: docker-compose.yml (full stack)

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
# OSS demo full stack: web + worker + PostgreSQL + Keycloak + MailHog
# Use: docker compose up -d
# For external Keycloak: docker compose -f docker-compose.byo-kc.yml up -d
# For PG only (legacy dev): docker compose -f docker-compose.dev.yml up -d
name: nudge

services:
  postgres:
    image: postgres:17-alpine
    container_name: nudge-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: nudge
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d nudge"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [nudge]

  keycloak:
    image: quay.io/keycloak/keycloak:26.0
    container_name: nudge-keycloak
    command: start-dev --import-realm --hostname-strict=false
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: admin
      KC_BOOTSTRAP_ADMIN_PASSWORD: admin
      KC_HOSTNAME: localhost
      KC_HTTP_ENABLED: "true"
      KC_HEALTH_ENABLED: "true"
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:-nudge-demo-client-secret-change-me}
    ports:
      - "8080:8080"
    volumes:
      - ./docker/keycloak:/opt/keycloak/data/import:ro
      - keycloak_data:/opt/keycloak/data
    healthcheck:
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/9000 && echo -e 'GET /health/ready HTTP/1.0\\r\\n\\r\\n' >&3 && head -1 <&3 | grep -q '200 OK'"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 30s
    networks: [nudge]

  migrate:
    image: nudge:v0.16
    build:
      context: .
    container_name: nudge-migrate
    command: pnpm migrate
    environment:
      DATABASE_URL_ADMIN: postgresql://postgres:postgres@postgres:5432/nudge
      NUDGE_APP_PASSWORD: ${NUDGE_APP_PASSWORD:-nudge_app_pass}
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
    networks: [nudge]

  web:
    image: nudge:v0.16
    build:
      context: .
    container_name: nudge-web
    command: pnpm start
    environment:
      DATABASE_URL_ADMIN: postgresql://postgres:postgres@postgres:5432/nudge
      DATABASE_URL_APP: postgresql://nudge_app:${NUDGE_APP_PASSWORD:-nudge_app_pass}@postgres:5432/nudge
      IRON_SESSION_PASSWORD: ${IRON_SESSION_PASSWORD:-nudge-demo-session-key-change-me-in-production}
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-nudge-web}
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:-nudge-demo-client-secret-change-me}
      OIDC_REDIRECT_URI_BASE: ${OIDC_REDIRECT_URI_BASE:-http://localhost:3000}
      NODE_ENV: production
    ports:
      - "3000:3000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      migrate:
        condition: service_completed_successfully
      keycloak:
        condition: service_healthy
    networks: [nudge]

  worker:
    image: nudge:v0.16
    build:
      context: .
    container_name: nudge-worker
    command: pnpm worker
    environment:
      DATABASE_URL_ADMIN: postgresql://postgres:postgres@postgres:5432/nudge
      DATABASE_URL_APP: postgresql://nudge_app:${NUDGE_APP_PASSWORD:-nudge_app_pass}@postgres:5432/nudge
      IRON_SESSION_PASSWORD: ${IRON_SESSION_PASSWORD:-nudge-demo-session-key-change-me-in-production}
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-nudge-web}
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:-nudge-demo-client-secret-change-me}
      OIDC_REDIRECT_URI_BASE: ${OIDC_REDIRECT_URI_BASE:-http://localhost:3000}
      NODE_ENV: production
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks: [nudge]

  mailhog:
    image: mailhog/mailhog:latest
    container_name: nudge-mailhog
    ports:
      - "1025:1025"  # SMTP
      - "8025:8025"  # Web UI
    networks: [nudge]

volumes:
  postgres_data:
  keycloak_data:

networks:
  nudge:
```

- [ ] **Step 2: Verify YAML**

```bash
docker compose config > /dev/null
```

Expected: no output (valid YAML / valid compose).

- [ ] **Step 3: Build and start**

```bash
docker compose up -d --build
```

Expected: 6 containers start. Wait ~60s for KC to become healthy.

- [ ] **Step 4: Verify health**

```bash
docker compose ps
```

Expected output should show all containers Running, with `postgres` and `keycloak` Healthy, `migrate` Exited(0).

```bash
curl -fs http://localhost:3000 -o /dev/null && echo "web OK"
curl -fs http://localhost:8080/realms/nudge -o /dev/null && echo "kc OK"
curl -fs http://localhost:8025 -o /dev/null && echo "mailhog OK"
```

Expected: 3 lines of "OK".

- [ ] **Step 5: Verify worker is running**

```bash
docker compose logs --tail=10 worker
```

Expected: includes `[worker] started, tick interval = 60000 ms`.

- [ ] **Step 6: Stop and clean for next task**

```bash
docker compose down -v
```

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(v0.16): add docker-compose.yml for OSS demo full stack

web + worker + postgres + keycloak + mailhog. start-dev --import-realm
で nudge realm を起動時に自動 import。migrate サービスが nudge_app
パスワードも設定するため、web/worker は app role でアクセス可能に
なってから起動。\${VAR:-default} で未設定時のデモ用デフォルト値を
提供（本番では .env で上書き必須）。"
```

---

## Task 6: docker-compose.byo-kc.yml (KC excluded)

**Files:**
- Create: `docker-compose.byo-kc.yml`

- [ ] **Step 1: Create docker-compose.byo-kc.yml**

Copy `docker-compose.yml` to `docker-compose.byo-kc.yml` and modify:

- Remove `keycloak` service entirely
- Remove `keycloak_data` volume
- Update `web.depends_on` to drop the `keycloak` condition (keep only `migrate`)
- At top, add comment block explaining usage

Final `docker-compose.byo-kc.yml`:

```yaml
# Bring Your Own Keycloak: external KC, Nudge stack only.
# Use: docker compose -f docker-compose.byo-kc.yml up -d
# Set OIDC_* and OIDC_REDIRECT_URI_BASE in .env to point at your KC.
name: nudge-byo-kc

services:
  postgres:
    image: postgres:17-alpine
    container_name: nudge-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: nudge
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d nudge"]
      interval: 5s
      timeout: 5s
      retries: 10
    networks: [nudge]

  migrate:
    image: nudge:v0.16
    build:
      context: .
    container_name: nudge-migrate
    command: pnpm migrate
    environment:
      DATABASE_URL_ADMIN: postgresql://postgres:postgres@postgres:5432/nudge
      NUDGE_APP_PASSWORD: ${NUDGE_APP_PASSWORD:-nudge_app_pass}
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
    networks: [nudge]

  web:
    image: nudge:v0.16
    build:
      context: .
    container_name: nudge-web
    command: pnpm start
    environment:
      DATABASE_URL_ADMIN: postgresql://postgres:postgres@postgres:5432/nudge
      DATABASE_URL_APP: postgresql://nudge_app:${NUDGE_APP_PASSWORD:-nudge_app_pass}@postgres:5432/nudge
      IRON_SESSION_PASSWORD: ${IRON_SESSION_PASSWORD:?IRON_SESSION_PASSWORD is required}
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:?OIDC_CLIENT_ID is required}
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:?OIDC_CLIENT_SECRET is required}
      OIDC_REDIRECT_URI_BASE: ${OIDC_REDIRECT_URI_BASE:?OIDC_REDIRECT_URI_BASE is required}
      NODE_ENV: production
    ports:
      - "3000:3000"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks: [nudge]

  worker:
    image: nudge:v0.16
    build:
      context: .
    container_name: nudge-worker
    command: pnpm worker
    environment:
      DATABASE_URL_ADMIN: postgresql://postgres:postgres@postgres:5432/nudge
      DATABASE_URL_APP: postgresql://nudge_app:${NUDGE_APP_PASSWORD:-nudge_app_pass}@postgres:5432/nudge
      IRON_SESSION_PASSWORD: ${IRON_SESSION_PASSWORD:?IRON_SESSION_PASSWORD is required}
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:?OIDC_CLIENT_ID is required}
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:?OIDC_CLIENT_SECRET is required}
      OIDC_REDIRECT_URI_BASE: ${OIDC_REDIRECT_URI_BASE:?OIDC_REDIRECT_URI_BASE is required}
      NODE_ENV: production
    depends_on:
      migrate:
        condition: service_completed_successfully
    networks: [nudge]

  mailhog:
    image: mailhog/mailhog:latest
    container_name: nudge-mailhog
    ports:
      - "1025:1025"
      - "8025:8025"
    networks: [nudge]

volumes:
  postgres_data:

networks:
  nudge:
```

Note: byo-kc uses `${VAR:?error}` syntax (error if unset) for OIDC vars instead of defaults — the user MUST configure these in `.env` for byo-kc mode.

- [ ] **Step 2: Verify YAML**

```bash
OIDC_CLIENT_ID=x OIDC_CLIENT_SECRET=y OIDC_REDIRECT_URI_BASE=http://localhost:3000 \
  IRON_SESSION_PASSWORD=test-pass-32-chars-minimum-aaaaaaaa \
  docker compose -f docker-compose.byo-kc.yml config > /dev/null
```

Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.byo-kc.yml
git commit -m "feat(v0.16): add docker-compose.byo-kc.yml for external Keycloak

KC を抜いた構成。OIDC_* 系は :? 構文で .env 必須化。
ユーザーが既存 KC（Entra ブローカー設定済みなど）を使う場合の
利用想定。realm 設定は docker/keycloak/nudge-realm.json を
KC admin UI から手動 import する手順を README に記載。"
```

---

## Task 7: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace setup section**

In `README.md`, replace the existing "クイックスタート" + "セットアップ手順" sections with the following:

```markdown
## クイックスタート

### OSS デモ（Docker Compose、所要時間 5 分）

すべてのサービス（web / worker / PostgreSQL / Keycloak / MailHog）を Docker Compose で立ち上げる：

\`\`\`bash
git clone https://github.com/tetsukame/nudge.git
cd nudge
docker compose up -d --build
\`\`\`

初回は Keycloak の起動に約 60 秒かかります。`docker compose ps` ですべてのサービスが Healthy になったら、以下の **3 ステップ** を実行してログイン画面まで到達：

\`\`\`bash
# 1. 初期テナント登録
docker compose exec postgres psql -U postgres -d nudge -c \\
  "INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url) \\
   VALUES ('dev', 'Dev', 'nudge', 'http://localhost:8080/realms/nudge');"

# 2. platform_admin 作成
docker compose exec web pnpm tsx src/scripts/create-platform-admin.ts \\
  admin@example.com "Admin" 'Strong-Password-2026!'

# 3. Keycloak テストユーザー作成（ブラウザで KC admin UI から）
#    http://localhost:8080/admin/master/console
#    user: admin / pass: admin でログイン
#    左上のドロップダウンで "nudge" realm に切り替え
#    Users → Add user
#      - Username: testuser
#      - Email: testuser@example.com
#      - Email verified: ON
#      - Save
#    Credentials タブ → Set password
#      - Password: test123
#      - Temporary: OFF
#      - Save
\`\`\`

→ http://localhost:3000/t/dev/login にアクセスして "testuser / test123" でログイン。

### Bring Your Own Keycloak（既存 KC 接続）

既存の Keycloak を使う場合は `docker-compose.byo-kc.yml` を使用：

\`\`\`bash
# 1. .env を作成（OIDC 系は必須）
cp .env.example .env
# 編集して OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI_BASE
# IRON_SESSION_PASSWORD を設定

# 2. 既存 KC に nudge realm を import
#    docker/keycloak/nudge-realm.json を KC admin UI から手動 import、または:
#    docker run --rm -v $(pwd)/docker/keycloak:/realms quay.io/keycloak/keycloak:26 \\
#      kc.sh import --file /realms/nudge-realm.json

# 3. 起動
docker compose -f docker-compose.byo-kc.yml up -d --build

# 以下、上記 3 ステップ（テナント登録 / platform_admin / KC ユーザー作成）は同様
# ただし KC URL は外部 KC のものに置き換える
\`\`\`

### ローカル開発（Next.js dev サーバ + PG だけ Docker）

`pnpm dev` で hot-reload しながら開発する場合は、PG だけ Docker で起動：

\`\`\`bash
pnpm install
cp .env.example .env  # 必要な値を設定（KC は別途用意）
docker compose -f docker-compose.dev.yml up -d
pnpm migrate
pnpm dev               # http://localhost:3000
\`\`\`

別ターミナルで通知ワーカー：

\`\`\`bash
pnpm worker:dev
\`\`\`

### 既存 PostgreSQL を共有する場合

Pleasanter 等と PG インスタンスを共有する場合は、共有 PG に `nudge` database を作成し、`docker-compose.byo-kc.yml` から `postgres` / `migrate` サービスを削除して `.env` の `DATABASE_URL_*` を外部 PG 向けに設定してください。本番セルフホスト構成は後続フェーズで正式整備します。
```

Also remove the now-obsolete sections "必要環境" などで Keycloak 26 を別途用意 (Phase 5b で対応予定) の文言を、 "Phase 5e で本番構成対応予定" に書き換える。具体的には：

```markdown
## 必要環境

- Docker Desktop または互換のコンテナランタイム
- （オプション）Node.js 20+ / pnpm 9+ — `pnpm dev` でローカル開発する場合のみ
```

- [ ] **Step 2: Verify markdown rendering by reading the file**

```bash
head -100 README.md
```

Confirm the new sections are properly formatted, no broken links, no syntax issues.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(v0.16): update README with Docker Compose setup instructions

3 つの起動モード（OSS デモ / BYO-KC / ローカル開発）の手順を
追加。OSS デモは docker compose up + 3 つの手動ステップで
ログイン画面到達。BYO-PG は将来 Phase 5e で正式整備する旨を
注記。"
```

---

## Task 8: End-to-end verification + push + PR

**Files:** none modified

- [ ] **Step 1: Clean state**

```bash
docker compose down -v 2>/dev/null
docker compose -f docker-compose.byo-kc.yml down -v 2>/dev/null
docker compose -f docker-compose.dev.yml down -v 2>/dev/null
```

- [ ] **Step 2: Full E2E test of OSS demo path**

```bash
docker compose up -d --build
```

Wait until `docker compose ps` shows all services healthy (about 60-90 seconds for KC).

```bash
# Step 1: tenant insert
docker compose exec postgres psql -U postgres -d nudge -c \
  "INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url) \
   VALUES ('dev', 'Dev', 'nudge', 'http://localhost:8080/realms/nudge');"
# Expected: INSERT 0 1

# Step 2: platform_admin
docker compose exec web pnpm tsx src/scripts/create-platform-admin.ts \
  admin@example.com "Admin" 'Strong-Password-2026!'
# Expected: ✅ created platform_admin id=...

# Step 3: KC test user — manual via UI (or via kcadm.sh):
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh create users -r nudge \
  -s username=testuser -s email=testuser@example.com -s emailVerified=true -s enabled=true
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh set-password -r nudge \
  --username testuser --new-password test123
# Expected: Created new user with id...
```

- [ ] **Step 3: Open browser and verify**

Open http://localhost:3000/t/dev/login → click ログイン → Keycloak 画面 → testuser / test123 でログイン → Nudge トップ画面が表示される。

- [ ] **Step 4: Verify all three compose files config-validate**

```bash
docker compose config > /dev/null
OIDC_CLIENT_ID=x OIDC_CLIENT_SECRET=y OIDC_REDIRECT_URI_BASE=http://localhost:3000 \
  IRON_SESSION_PASSWORD=test-pass-32-chars-minimum-aaaaaaaa \
  docker compose -f docker-compose.byo-kc.yml config > /dev/null
docker compose -f docker-compose.dev.yml config > /dev/null
```

Expected: 3 commands, no output, exit 0.

- [ ] **Step 5: Run full test suite**

```bash
docker compose down
pnpm typecheck && pnpm test
```

Expected: typecheck clean, all 298+ unit/schema tests pass.

- [ ] **Step 6: Push and open PR**

```bash
git push -u origin feat/v016-docker-compose
gh pr create --title "feat(NDG-5 Phase 5b, v0.16): OSS distribution Docker Compose" --body "$(cat <<'EOF'
## Summary
NDG-5 (OSS リリース準備) の Phase 5b。`docker compose up` で web + worker + PG + Keycloak + MailHog が起動する OSS デモ用配布構成を実装。

親タスク: [NDG-5 OSS リリース準備](https://www.notion.so/350062c9be5c8129bd80d6913e8c0e83)
本タスク: [NDG-28 [Phase 5b] OSS 配布用 Docker Compose](https://www.notion.so/357062c9be5c81dca2c5f25553966073)
設計書: [docs/superpowers/specs/2026-05-05-v016-oss-distribution-design.md](docs/superpowers/specs/2026-05-05-v016-oss-distribution-design.md)
実装プラン: [docs/superpowers/plans/2026-05-06-v016-oss-distribution.md](docs/superpowers/plans/2026-05-06-v016-oss-distribution.md)

## Changes
### 新規ファイル
- `Dockerfile` — multi-stage 2 段（builder + runner）、tsx を runtime deps に保持
- `.dockerignore` — ビルドコンテキスト最適化
- `docker-compose.yml` — OSS デモ用フルスタック（KC 同梱）
- `docker-compose.byo-kc.yml` — Bring Your Own Keycloak モード
- `docker/keycloak/nudge-realm.json` — KC realm 定義（client のみ、ユーザー含まず）
- `tests/integration/migrate-app-password.test.ts` — nudge_app パスワード設定の統合テスト

### 既存ファイル更新
- `package.json` — `tsx` を deps へ昇格、`pg-format` + `@types/pg-format` 追加
- `src/migrate.ts` — `setAppRolePasswordFromEnv` 関数追加、CLI から呼び出し
- `README.md` — OSS デモ起動手順 + BYO-KC モード手順 + BYO-PG 注記追加

## 起動モード
| 用途 | コマンド |
|---|---|
| OSS デモ | `docker compose up -d --build` |
| BYO-KC（既存 KC 利用） | `docker compose -f docker-compose.byo-kc.yml up -d --build` |
| ローカル開発（既存） | `docker compose -f docker-compose.dev.yml up -d` + `pnpm dev` |

## Test plan
- [x] `pnpm typecheck` clean
- [x] `pnpm test` 全 pass（+1 新規 integration test）
- [x] `docker compose up -d --build` で全サービスが Healthy
- [x] OSS デモの 3 ステップ（テナント登録 / platform_admin / KC ユーザー作成）が README 通りに動く
- [x] http://localhost:3000/t/dev/login でログイン成功
- [x] 3 つの compose ファイルすべてが `docker compose config` で valid

## 既知の制限事項
- realm.json の `nudge-web` client secret は OSS デモ用にハードコード（`nudge-demo-client-secret-change-me`）。本番転用は不可、README で警告
- `extra_hosts: host.docker.internal:host-gateway` は Docker Desktop（Mac/Win）前提。Linux native でも動作するが Docker version 20.10+ 必要
- service account の sync 用 role bindings は手動（KC admin UI / kcadm.sh）。Phase 5e で自動化検討

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Update Notion**

Move NDG-28 ([Phase 5b]) to "PRレビュー" status with PR URL in 関連コミット.

---

## Self-Review Checklist

- [x] **Spec coverage**: Every section in the spec maps to at least one task above
  - File structure → Tasks 1-7 (each file)
  - Service構成 → Task 5
  - Dockerfile → Task 3
  - nudge-realm.json → Task 4
  - migrate.ts modification → Task 2
  - byo-kc mode → Task 6
  - README update → Task 7
- [x] **Placeholder scan**: No "TBD", "TODO", "fill in", "implement later"
- [x] **Type consistency**: `setAppRolePasswordFromEnv` is the same name in test (Task 2 step 1) and implementation (Task 2 step 3). All env var names match across compose files.

## Risks / Open Items (resolve during implementation)

- **KC `--import-realm` env substitution**: `${OIDC_CLIENT_SECRET}` substitution in realm.json relies on Keycloak feature. Verify in Task 5 step 4 that the client secret is correctly applied. If not, fall back to literal value with a warning in README.
- **`extra_hosts` host-gateway on Linux**: Works on Docker Desktop (Mac/Win). For native Linux, may need `network_mode: host` or different approach. Test on user's Windows + verify on Linux later.
- **KC healthcheck endpoint**: Used `/health/ready` on port 9000 (KC 26 default). If KC version mismatch, adjust to TCP probe on 8080.
- **Image tag**: Uses `nudge:v0.16` literal. For multi-PR development, consider `nudge:dev` to avoid version baking-in. Decide before commit.
