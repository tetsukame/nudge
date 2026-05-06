# Nudge

組織内の依頼事項（アンケート・作業依頼）を軽く促して対応状況を可視化する OSS タスク管理ツール。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 概要

行政・大企業のように「メールでお願い → 誰が出したかわからない → 督促が大変」になりがちな業務依頼を、テナント単位でまとめて見える化することを目的とした Web アプリです。Keycloak と連携してユーザー / 組織 / グループを取得し、依頼の送信・対応・督促・通知（メール / Teams / Slack）までを一元化します。

## 機能（v0.14 時点）

- **依頼管理**: 依頼作成、配信先指定（個人 / 組織 / グループ）、期限管理、Markdown 本文（裸 URL も自動リンク化）
- **対応フロー**: 未開封 / 既読 / 対応中 / 完了 / 差戻し のステータス、コメント、回答収集
- **マルチテナント**: PostgreSQL 17 の Row-Level Security でテナント分離。`/t/<tenant_code>/...` URL 体系
- **OIDC 認証**: Keycloak 26 を IdP として利用（外部 IdP ブローカー経由の SSO にも対応可）
- **同期**: Keycloak からユーザー / 組織 / グループを定期同期（API キーで保護されたエンドポイント）
- **通知**: メール（SMTP）→ Teams Webhook → Slack Webhook の優先順位でフォールバック、永続失敗時はバッジ表示
- **管理 UI**: tenant_admin 用ダッシュボード（ユーザー / 組織 / グループ / 通知設定 / 同期実行）
- **ルート管理**: platform_admin によるテナント追加・削除、ローカル認証
- **組織のソフトデリート**: `org_unit.status = archived` で履歴保持。Keycloak で消えた組織は自動 archived 化、復活時に自動 active 化

リポジトリは活発に開発中で、`v1.0` 安定版に向けて API 互換性は変更され得ます。

## 必要環境

- Docker Desktop または互換のコンテナランタイム
- （オプション）Node.js 20+ / pnpm 9+ — `pnpm dev` でローカル開発する場合のみ

## クイックスタート

### OSS デモ（Docker Compose、所要時間 5 分）

すべてのサービス（web / worker / PostgreSQL / Keycloak / MailHog）を Docker Compose で立ち上げる：

```bash
git clone https://github.com/tetsukame/nudge.git
cd nudge
docker compose up -d --build
```

初回は Keycloak の起動に約 60 秒かかります。`docker compose ps` ですべてのサービスが Healthy になったら、以下の **3 ステップ** を実行してログイン画面まで到達：

```bash
# 1. 初期テナント登録
docker compose exec postgres psql -U postgres -d nudge -c \
  "INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url) \
   VALUES ('dev', 'Dev', 'nudge', 'http://host.docker.internal:8080/realms/nudge');"

# 2. platform_admin 作成
docker compose exec web pnpm tsx src/scripts/create-platform-admin.ts \
  admin@example.com "Admin" 'Strong-Password-2026!'

# 3. Keycloak テストユーザー作成
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password admin
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh create users -r nudge \
  -s username=testuser -s email=testuser@example.com \
  -s emailVerified=true -s enabled=true
docker compose exec keycloak /opt/keycloak/bin/kcadm.sh set-password -r nudge \
  --username testuser --new-password test123
```

→ http://host.docker.internal:3000/t/dev/login にアクセスして "testuser / test123" でログイン。

各サービスの URL（Docker Desktop が `host.docker.internal` を hosts ファイルに自動追加します。Linux native の場合は `--add-host=host.docker.internal:host-gateway` 相当の設定が必要）：

- Nudge: http://host.docker.internal:3000
- Keycloak admin console: http://host.docker.internal:8080/admin/master/console (admin/admin)
- MailHog UI（送信メール確認）: http://host.docker.internal:8025

> ℹ️ なぜ `host.docker.internal` か：Docker Compose 内の web container が KC への OIDC discovery を行う際、ブラウザと web container 双方から同じ URL で KC にアクセスできる必要があります。`localhost` は container 内で container 自身を指すので使えません。`host.docker.internal` は Docker Desktop が自動的にホスト側を指すよう解決してくれます。

> ⚠️ デフォルトの `OIDC_CLIENT_SECRET` / `IRON_SESSION_PASSWORD` はデモ用にハードコードされています。本番転用は不可。`.env` で必ず上書きしてください。

### Bring Your Own Keycloak（既存 KC 接続）

既存の Keycloak を使う場合は `docker-compose.byo-kc.yml` を使用：

```bash
# 1. .env を作成（OIDC 系は必須）
cp .env.example .env
# 編集して OIDC_CLIENT_ID / OIDC_CLIENT_SECRET / OIDC_REDIRECT_URI_BASE
# IRON_SESSION_PASSWORD を設定

# 2. 既存 KC に nudge realm を import
#    docker/keycloak/nudge-realm.json を KC admin UI から手動 import、または:
docker run --rm -v $(pwd)/docker/keycloak:/realms quay.io/keycloak/keycloak:26 \
  start --import-realm --optimized --dir /realms

# 3. 起動
docker compose -f docker-compose.byo-kc.yml up -d --build

# 以下、上記 3 ステップ（テナント登録 / platform_admin / KC ユーザー作成）は同様
# ただし KC の URL とテナントの keycloak_issuer_url は外部 KC のものに置き換える
```

### ローカル開発（Next.js dev サーバ + PG だけ Docker）

`pnpm dev` で hot-reload しながら開発する場合は、PG だけ Docker で起動：

```bash
pnpm install
cp .env.example .env  # 必要な値を設定（KC は別途用意）
docker compose -f docker-compose.dev.yml up -d
pnpm migrate
pnpm dev               # http://localhost:3000
```

別ターミナルで通知ワーカー：

```bash
pnpm worker:dev
```

### 既存 PostgreSQL を共有する場合

Pleasanter 等と PG インスタンスを共有する場合は、共有 PG に `nudge` database を作成し、`docker-compose.byo-kc.yml` から `postgres` / `migrate` サービスを削除して `.env` の `DATABASE_URL_ADMIN` / `DATABASE_URL_APP` を外部 PG 向けに設定してください。本番セルフホスト構成は後続フェーズで正式整備します。

## 開発

```bash
pnpm dev          # Next.js 開発サーバ
pnpm worker:dev   # 通知ワーカー（watch モード）
pnpm migrate      # 未適用マイグレーション実行
pnpm test         # unit + schema + RLS テスト（テストコンテナ自動起動）
pnpm test:integration  # 統合テスト
pnpm test:all     # 全テスト
pnpm typecheck    # TypeScript 型チェック
pnpm build        # 本番ビルド
pnpm start        # 本番サーバ起動
```

## ディレクトリ構成

| パス | 役割 |
|---|---|
| `app/` | Next.js App Router（テナント・ルート画面・API ルート） |
| `src/auth/` | iron-session セッション管理 |
| `src/db/` | PG プール、`withTenant` RLS ヘルパー |
| `src/domain/` | ドメインロジック（依頼 / 通知 / 管理 / 組織 など） |
| `src/notification/` | 通知チャネル抽象化（mail / teams / slack）と暗号化 |
| `src/sync/` | Keycloak からの user / org / group 同期 |
| `src/worker/` | 通知ワーカー（cron 風スケジューラー） |
| `src/ui/components/` | 再利用 UI コンポーネント |
| `migrations/` | 番号付き SQL マイグレーション |
| `tests/unit/` | ドメイン・UI ユニットテスト |
| `tests/schema/` | DB スキーマ・制約テスト |
| `tests/rls/` | RLS テナント分離テスト |
| `tests/integration/` | API ルート統合テスト |
| `docs/superpowers/specs/` | 設計仕様書 |
| `docs/superpowers/plans/` | 実装プラン |

## ドキュメント

- [DB ERD v0.1 設計書](docs/superpowers/specs/2026-04-11-db-erd-design.md)
- 詳細仕様は `docs/superpowers/specs/`、各リリースの実装プランは `docs/superpowers/plans/` 配下

## コントリビューション

バグ報告・機能要望は [GitHub Issues](https://github.com/tetsukame/nudge/issues) へ。プルリクエスト前に [CONTRIBUTING.md](CONTRIBUTING.md) を確認してください。

セキュリティに関する報告は [SECURITY.md](SECURITY.md) を参照（公開 Issue ではなく Security Advisory 経由で）。

## ライセンス

[MIT License](LICENSE)
