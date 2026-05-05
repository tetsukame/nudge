# v0.16 OSS 配布構成 設計書

- **バージョン**: v0.16
- **タスク**: NDG-5 Phase 5b（親: [NDG-5 OSS リリース準備](https://www.notion.so/350062c9be5c8129bd80d6913e8c0e83)）
- **作成日**: 2026-05-05
- **目的**: 「`git clone && docker compose up` で 5 分後にログイン画面まで触れる」OSS デモ用配布構成を整備する

## 背景

NDG-5（OSS リリース準備）を 4 Phase に分割したうちの 5b。

- **Phase 5a（v0.15、完了）**: LICENSE / README / CONTRIBUTING / SECURITY / .env.example
- **Phase 5b（本タスク、v0.16）**: 配布用 docker-compose + Dockerfile + Keycloak realm 自動 import
- **Phase 5c（v0.17）**: GitHub Actions CI/CD + dependabot + PR テンプレート
- **Phase 5d（v1.0-rc 直前）**: CHANGELOG / release.yml / v1.0 移行ガイド
- **Phase 5e（後続、想定）**: 本番セルフホスト構成（HTTPS / リバースプロキシ / バックアップ / モニタリング）

## ゴール

1. **OSS デモ用フルスタック**: `docker compose up` で web + worker + PostgreSQL + Keycloak + MailHog が起動し、自動的にマイグレーションと realm import が完了する
2. **既存 KC 利用モード**: `docker compose -f docker-compose.byo-kc.yml up` で外部 Keycloak に接続するモードを提供
3. **既存開発フロー保護**: 現在の `docker-compose.dev.yml`（PG だけ）を残し、`pnpm dev` 派の開発者ワークフローを壊さない
4. **半自動セットアップ**: マイグレーションと realm 作成は自動。残る「初期テナント登録」「platform_admin 作成」「Keycloak テストユーザー作成」の 3 ステップは README で明示的に手順を示す

## スコープ外

以下は Phase 5e で対応：

- HTTPS / TLS / リバースプロキシ（nginx, traefik 等）
- 本番シークレット管理（Docker secrets, Vault 等）
- バックアップ / リストア手順
- モニタリング / ロギング統合
- イメージサイズ最適化（Next.js standalone 化）
- 完全自動化（テストユーザー含む dev-realm.json）

## 構成

### ファイル構成

```
nudge/
├── Dockerfile                        # 新規（multi-stage、web + worker 兼用イメージ）
├── docker-compose.yml                # 新規（OSS デモ用フルスタック、KC 同梱）
├── docker-compose.byo-kc.yml         # 新規（Bring Your Own Keycloak、KC 抜き）
├── docker-compose.dev.yml            # 既存・残す（PG だけの軽量 dev 用）
├── docker/
│   └── keycloak/
│       └── nudge-realm.json          # 新規（同梱 KC 用 realm 定義、ユーザー含まず）
├── tsconfig.scripts.json             # 新規（worker / migrate / scripts を JS にビルド）
├── next.config.mjs                   # 変更なし（standalone 化はしない）
├── package.json                      # 修正（build:scripts / worker:prod / migrate:prod 等を追加、pg-format 依存追加）
├── src/migrate.ts                    # 修正（末尾に NUDGE_APP_PASSWORD 反映処理を追加）
└── README.md                         # 修正（OSS デモ手順 + byo-kc 手順を追加）
```

### 起動モード

| 用途 | コマンド | KC | 用例 |
|---|---|---|---|
| OSS デモ / 試用 | `docker compose up` | 同梱（自動 realm import） | 初めて触る人 |
| 既存 KC 接続 | `docker compose -f docker-compose.byo-kc.yml up` | 外部（自分で構築済み） | テスト環境 / プレ本番 |
| PG だけ | `docker compose -f docker-compose.dev.yml up` | なし | `pnpm dev` 派の既存開発者 |

## サービス構成（`docker-compose.yml`）

| サービス | イメージ | 役割 | depends_on |
|---|---|---|---|
| `postgres` | `postgres:17-alpine` | DB | - |
| `keycloak` | `quay.io/keycloak/keycloak:26` | IdP（`start-dev --import-realm` で realm.json を起動時 import） | - |
| `migrate` | Nudge image | マイグレーション init container（`node dist/migrate.js`、`restart: "no"`） | postgres (healthy) |
| `web` | Nudge image | Next.js（`npm start`） | migrate (completed), keycloak (healthy) |
| `worker` | Nudge image | 通知ワーカー（`node dist/worker/main.js`） | migrate (completed) |
| `mailhog` | `mailhog/mailhog` | SMTP テスト用 | - |

### Keycloak realm import の選定

NDG-5 の元の対応方針では `adorsys/keycloak-config-cli` サイドカー方式だったが、Phase 5b では Keycloak 26 標準の `start-dev --import-realm` を採用する：

- **`--import-realm`**（採用）: KC 起動引数で完結、サービス 1 つ少ない、依存 image なし
- **`keycloak-config-cli`**（不採用、Phase 5e で再検討）: 冪等性・差分検知が強いが本番運用向きの機能。OSS デモには過剰

### `docker-compose.byo-kc.yml` との差分

`docker-compose.yml` から `keycloak` サービスを削除した version：

```yaml
services:
  postgres: ...        # 同じ
  migrate: ...         # 同じ
  web:
    environment:
      OIDC_REDIRECT_URI_BASE: ${OIDC_REDIRECT_URI_BASE:-http://localhost:3000}
      # KC 関連の URL は .env で上書き
    depends_on:
      migrate: { condition: service_completed_successfully }
      # keycloak の depends_on を削除
  worker: ...          # 同じ
  mailhog: ...         # 同じ
  # keycloak 削除
```

ユーザーが `.env` で外部 KC の OIDC 値を設定し、realm import は別途手動。

### Volumes / Network

- 名前付きボリューム: `postgres_data`, `keycloak_data`（永続化）
- ネットワーク: `nudge` という名前の単一 bridge

## Dockerfile（multi-stage 3 段）

```
deps    → pnpm install --frozen-lockfile（依存キャッシュ層）
builder → pnpm build (Next.js production)
        + pnpm exec tsc -p tsconfig.scripts.json（worker/migrate/scripts を JS 化）
runner  → production deps のみ + .next/ + dist/ + migrations/
```

### `tsconfig.scripts.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "noEmit": false,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": false
  },
  "include": [
    "src/migrate.ts",
    "src/worker/**/*.ts",
    "src/scripts/**/*.ts",
    "src/db/**/*.ts",
    "src/domain/**/*.ts",
    "src/notification/**/*.ts",
    "src/sync/**/*.ts",
    "src/auth/**/*.ts",
    "src/config.ts"
  ]
}
```

ts→js 変換対象は worker / migrate / bootstrap CLI が依存する範囲のみ。Next.js（`app/`, UI コンポーネント）は別経路（`next build`）でビルドされる。

### `package.json` scripts 追加

```json
{
  "scripts": {
    "build:scripts": "tsc -p tsconfig.scripts.json",
    "worker:prod": "node dist/worker/main.js",
    "migrate:prod": "node dist/migrate.js",
    "bootstrap:platform-admin:prod": "node dist/scripts/create-platform-admin.js"
  }
}
```

### Compose の CMD（runner ベースで切り替え）

- `web`: `npm start`（Next.js production server）
- `worker`: `node dist/worker/main.js`
- `migrate`: `node dist/migrate.js`（exit 0 で完了）
- bootstrap CLI: `docker compose exec web node dist/scripts/create-platform-admin.js <args>`

### Next.js standalone を採用しない理由

worker / migrate / bootstrap も同じイメージで動かす都合上、production deps をフルで持つ方が単純。standalone 化は web 起動だけを最小化する手法で、共有イメージとは相性が悪い。Phase 5e で本番最適化する際にイメージを分離して再検討する。

## `nudge-realm.json` の内容

最小構成（B = 半自動なのでユーザー作成は手動）：

| 設定 | 値 |
|---|---|
| Realm name | `nudge` |
| Display name | `Nudge` |
| Client | `nudge-web`（confidential, standard flow） |
| Redirect URIs | `http://localhost:3000/t/*/auth/callback` |
| Web origins | `http://localhost:3000` |
| Default scopes | `email`, `profile` |
| Service account roles | `view-users`, `view-realm`, `view-groups`（同期用） |
| Access token lifespan | 5 min |
| Login theme | デフォルト |

**含めない**: ユーザー / グループ / 組織（手動作成手順を README に記載）

### Client secret の扱い

`OIDC_CLIENT_SECRET` は realm.json に固定値を入れず、Compose 起動時に `.env` の値で realm を再構成できるようにする。最小実装：

- realm.json に `${OIDC_CLIENT_SECRET}` プレースホルダを置く
- KC `--import-realm` は `--spi-import-replace=true` で再 import 時の上書きが可能
- 初回起動時は `.env` の値で固定 import される

詳細実装は plan で詰める。

## PostgreSQL 初期化と nudge_app パスワード

**init.sql は使わない**。理由：postgres init script は migrate より前に走るため、migration 018（nudge_app ロール作成）がまだ存在しない時点で nudge_app を操作できない。

代わりに **migrate.ts を拡張**：

```ts
// migrate.ts の末尾に追加
import format from 'pg-format';

const appPassword = process.env.NUDGE_APP_PASSWORD;
if (appPassword) {
  await pool.query(format('ALTER ROLE nudge_app PASSWORD %L', appPassword));
  console.log('updated nudge_app password from NUDGE_APP_PASSWORD env');
}
```

`pg-format` を依存に追加する（`%L` でリテラルを安全にエスケープ）。

Compose 側で `NUDGE_APP_PASSWORD=nudge_app_pass` を `migrate` サービスに渡し、migrate 完了後に `nudge_app` のパスワードがセットされ、`web`/`worker` が `DATABASE_URL_APP=postgresql://nudge_app:nudge_app_pass@postgres:5432/nudge` で接続可能になる。

## ヘルスチェックと起動順序

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 10

keycloak:
  command: start-dev --import-realm
  healthcheck:
    test: ["CMD-SHELL", "exec 3<>/dev/tcp/localhost/8080 || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 30   # KC は起動が遅い（30s〜60s）

migrate:
  depends_on:
    postgres:
      condition: service_healthy
  command: node dist/migrate.js
  restart: "no"

web:
  depends_on:
    migrate:
      condition: service_completed_successfully
    keycloak:
      condition: service_healthy

worker:
  depends_on:
    migrate:
      condition: service_completed_successfully
```

## 環境変数の流し方

ルートの `.env`（`.env.example` をコピー）が web/worker/migrate に注入される。Compose 内部のサービス間 URL はデフォルト値を Compose 側で持つ：

- `DATABASE_URL_ADMIN=postgresql://postgres:postgres@postgres:5432/nudge`
- `DATABASE_URL_APP=postgresql://nudge_app:nudge_app_pass@postgres:5432/nudge`
- `OIDC_REDIRECT_URI_BASE=http://localhost:3000`
- `NUDGE_APP_PASSWORD=nudge_app_pass`（migrate 用）

### Keycloak issuer URL の食い違い問題

- compose 内部から見た KC: `http://keycloak:8080/realms/nudge`
- ブラウザから見た KC: `http://localhost:8080/realms/nudge`

これらが食い違うと OIDC discovery で issuer mismatch エラーになる。`KC_HOSTNAME=localhost` を Keycloak サービスに設定して、発行 issuer を `http://localhost:8080` に統一する。これにより：

- ブラウザ → `http://localhost:8080/...` でログイン
- web サーバ → 同じ issuer URL（`localhost`）で discovery & token 検証

Compose 内部から `localhost` 解決のために、`web` サービスに `extra_hosts: ["localhost:host-gateway"]` を追加して compose 内 DNS で `localhost` を host へ向ける。

## マニュアル手順（README 追記）

`docker compose up -d` 後の **3 ステップ**：

```bash
# 1. 初期テナント登録
docker compose exec postgres psql -U postgres -d nudge -c \
  "INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url) \
   VALUES ('dev', 'Dev', 'nudge', 'http://localhost:8080/realms/nudge');"

# 2. platform_admin 作成
docker compose exec web npm run bootstrap:platform-admin:prod -- \
  admin@example.com "Admin" 'Strong-Password-2026!'

# 3. Keycloak テストユーザー作成
# http://localhost:8080/admin/master/console
# admin/admin でログイン → nudge realm → Users → Add user
# email + email-verified ON + Credentials タブでパスワード設定
```

→ `http://localhost:3000/t/dev/login` でログイン可能。

### byo-kc モードでの追加手順

```bash
# .env で外部 KC の値を設定
DATABASE_URL_ADMIN=postgresql://postgres:postgres@postgres:5432/nudge
OIDC_CLIENT_ID=<your-client-id>
OIDC_CLIENT_SECRET=<your-client-secret>
OIDC_REDIRECT_URI_BASE=http://localhost:3000

# 外部 KC に nudge-realm.json を import（KC admin UI から手動 import、または kcadm.sh で）

# 起動
docker compose -f docker-compose.byo-kc.yml up -d
# 以下、テナント登録 / platform_admin 作成は同梱モードと同じ
```

## テスト方針

- **動作確認 1**: `docker compose up` から `http://localhost:3000/t/dev/login` までの 3 ステップが README 通りに動くことを Windows / macOS / Linux で確認
- **動作確認 2**: `docker compose -f docker-compose.byo-kc.yml up` で外部 KC に接続できることを既存 KC（192.168.1.105）で確認
- **動作確認 3**: `docker compose -f docker-compose.dev.yml up` で既存開発フローが壊れていないことを確認
- **既存テスト**: `pnpm test` (unit + schema + RLS) が green であること
- **タイプチェック**: `tsc --noEmit` が clean
- **ビルドチェック**: `pnpm build` と `pnpm build:scripts` が両方成功

## 完了条件

- 上記ファイル群が main にマージ済み
- README の手順通りに新規環境（クリーンな Docker Desktop）で `docker compose up` から動作確認 OK
- 既存 `pnpm test` / `pnpm build` に regression なし
- 既存 `docker-compose.dev.yml` ベースの開発フローが影響を受けないこと

## オープンクエスチョン

- realm.json の `${OIDC_CLIENT_SECRET}` プレースホルダ展開を Compose レベルで行うか、KC import 時に行うかは実装段階で確定
- `KC_HOSTNAME=localhost` + `extra_hosts: localhost:host-gateway` 組み合わせの Linux / Windows 互換性は実装段階で検証

## 関連リンク

- 親タスク: [NDG-5 OSS リリース準備](https://www.notion.so/350062c9be5c8129bd80d6913e8c0e83)
- Phase 5a 完了: PR #10
