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

リポジトリは活発に開発中で、`v1.0` 安定版に向けて API 互換性は変更され得ます。バージョニング方針は [docs/versioning.md](docs/versioning.md)（Phase 5b 以降で整備予定）参照。

## 必要環境

- Node.js 20+
- pnpm 9+
- Docker Desktop（ローカル PostgreSQL とテストコンテナ用）
- Keycloak 26（別途用意。OSS 同梱 Docker Compose は Phase 5b で対応予定）

## クイックスタート

```bash
git clone https://github.com/tetsukame/nudge.git
cd nudge
pnpm install
cp .env.example .env   # DATABASE_URL_* / IRON_SESSION_PASSWORD / OIDC_* を設定
docker compose -f docker-compose.dev.yml up -d   # ローカル PostgreSQL を起動
pnpm migrate           # マイグレーションを実行
pnpm dev               # http://localhost:3000 で開発サーバ起動
```

別ターミナルで通知ワーカーも起動する：

```bash
pnpm worker:dev
```

## セットアップ手順

### 1. PostgreSQL

`docker-compose.dev.yml` がローカル開発用 PG (17-alpine) を `localhost:5432` で起動します。`DATABASE_URL_ADMIN` には superuser を、`DATABASE_URL_APP` には migration `018` で作成される `nudge_app` ロール（RLS 強制）を指定してください。`nudge_app` のパスワードは初回 migration 後に自分で設定します：

```bash
psql $DATABASE_URL_ADMIN -c "ALTER ROLE nudge_app PASSWORD 'your-secret'"
```

### 2. Keycloak

別途 Keycloak 26 を立てて、OIDC クライアントを作成してください。詳細は [docs/keycloak-setup.md](docs/keycloak-setup.md)（Phase 5b で整備予定）。当面は以下の設定が必要です：

- Realm: 任意（テナントごとに別 realm 推奨）
- Client: Confidential、`http://localhost:3000/t/<tenant_code>/auth/callback` を redirect URI に追加
- Client Scope: `email`, `profile` を ID トークンに含める
- 同期用に `view-users`, `view-realm`, `view-groups` の admin ロールを付与した service account を別途用意

### 3. テナントの登録

最初のテナントは管理者が SQL で直接登録します（platform_admin UI 完成後は UI 経由で可能になります）：

```bash
psql $DATABASE_URL_ADMIN <<'EOF'
INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
VALUES ('dev', 'Dev Tenant', 'dev-realm', 'http://localhost:8080/realms/dev-realm');
EOF
```

### 4. platform_admin の作成

ルート管理画面 (`/root/login`) 用の管理者アカウントを作成します：

```bash
pnpm tsx src/scripts/create-platform-admin.ts <email> <displayName> <strong-password>
```

パスワードは 12 文字以上 + 英大小文字 + 数字 + 記号 が必要です。

### 5. ログイン

- テナントログイン: `http://localhost:3000/t/dev/login` → Keycloak へリダイレクト
- ルート管理: `http://localhost:3000/root/login`

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
