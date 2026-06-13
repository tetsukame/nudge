# NudgeFlow

組織内の依頼事項（アンケート・作業依頼）を軽く促して対応状況を可視化する OSS タスク管理ツール。

> **Note**: 技術名（リポジトリ名、Docker image 名、URL path、コードベース内の識別子）は引き続き `nudge` を使用しています。表示名（ブランド名）が `NudgeFlow` です。

[![CI](https://github.com/tetsukame/nudge/actions/workflows/test.yml/badge.svg)](https://github.com/tetsukame/nudge/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 概要

行政・大企業のように「メールでお願い → 誰が出したかわからない → 督促が大変」になりがちな業務依頼を、テナント単位でまとめて見える化することを目的とした Web アプリです。Keycloak と連携してユーザー / 組織 / グループを取得し、依頼の送信・対応・督促・通知（メール / Teams / Slack）までを一元化します。

## 機能（v0.24 時点）

- **ダッシュボード**: ログイン後、自分宛の未対応 / 送信した依頼の進捗 / 部下の未処理をサマリ表示
- **依頼管理**: 依頼作成、配信先指定（個人 / 組織 / グループ）、期限・想定所要時間、Markdown 本文（ツールバー＋裸 URL 自動リンク）、過去依頼のコピー再利用
- **依頼テンプレ**: 部 / 課単位で共有する依頼の雛形。月次・四半期の定例依頼を 1 クリックで起票
- **予約送信**: 未来日時に発送予約、worker が到来時に発火。発送前ならキャンセル可（受信者には不可視）
- **AI 整形（オプション）**: 要件メモ → タイトル + 本文を AI が提案。Dify workflow / OpenAI 互換 API (LM Studio / Ollama / OpenAI / OpenRouter) を切替可。テナント単位でオプトイン、デフォルト OFF
- **対応フロー**: 未開封 / 開封 / 対応中 / 完了 / 差戻し のステータス、コメント、対象者一覧
- **督促**: 手動リマインド（1h レート制限）、全員への一斉コメント、未対応者・期限切れへのディープリンク
- **マネージャ機能**: 部下の未処理ボード（タスク／人トグル・完了率・期限フィルタ・個別リマインド）、退職依頼者の差し替え
- **代理完了 / 依頼取り消し**: マネージャ・tenant_admin が「本人不在」「依頼者判断」等のカテゴリ付きで代理完了。依頼者・tenant_admin は理由付きで取り消し可能（assignee 全員に通知）
- **監査ログ + auditor ロール**: 全イベント記録、actor/対象種別/期間でフィルタ、CSV エクスポート。閲覧専用の `auditor` ロール
- **マルチテナント**: PostgreSQL 17 の Row-Level Security でテナント分離。`/t/<tenant_code>/...` URL 体系
- **OIDC 認証**: Keycloak 26 を IdP として利用（外部 IdP ブローカー経由 SSO・Microsoft Teams タブ統合 β）
- **同期**: Keycloak からユーザー / 組織 / グループ / 職位（`position` → 管理職ロール）を定期同期
- **通知**: メール（SMTP）→ Teams Webhook → Slack Webhook の優先順位でフォールバック、永続失敗時はバッジ表示・手動再送
- **管理 UI**: tenant_admin 用（ユーザー / 組織 / グループ / ロール / マネージャ割当 / 職位設定 / 通知設定 / AI 整形設定 / データ保持設定 (v0.25 で UI、v0.24 は API のみ) / 依頼テンプレ / 同期実行） + 監査ログ (`/audit`、auditor も閲覧可)
- **データ保持 (retention)**: 通知履歴 / 監査ログ / 遷移履歴 / 同期ログを組織のルールに沿って整理。tenant 単位の保持日数 + ソフト → ハード削除の 2 段階（grace 7 日）。デフォルト無効で既存環境は無影響
- **ルート管理**: platform_admin によるテナント追加・削除
- **組織のソフトデリート**: `org_unit.status = archived` で履歴保持。Keycloak で消えた組織は自動 archived 化、復活時に自動 active 化

製品名は **NudgeFlow**（技術名・リポジトリは `nudge`）。バージョンごとの変更は [CHANGELOG.md](CHANGELOG.md)、
機能の概要は [docs/overview.md](docs/overview.md) を参照。リポジトリは活発に開発中で、`v1.0` 安定版に向けて API 互換性は変更され得ます。

## 必要環境

- Docker Desktop または互換のコンテナランタイム
- （オプション）Node.js 20+ / pnpm 9+ — `pnpm dev` でローカル開発する場合のみ

## クイックスタート

### Pre-built image を使う（最速、ビルド不要）

`docker compose up --build` でローカルビルドする代わりに、ghcr.io から事前ビルド済みイメージを pull できます：

```yaml
# docker-compose.override.yml （以下の内容で作成）
services:
  web:
    image: ghcr.io/tetsukame/nudge:latest
    build: !reset
  worker:
    image: ghcr.io/tetsukame/nudge:latest
    build: !reset
  migrate:
    image: ghcr.io/tetsukame/nudge:latest
    build: !reset
```

```bash
docker compose --env-file .env.demo up -d
```

特定バージョンを使いたい場合は `:latest` を `:v0.16` 等に置換してください。
Multi-arch 対応（`linux/amd64` + `linux/arm64`）なので Apple Silicon や ARM ベースのクラウド VM（Azure、AWS Graviton 等）でもそのまま使えます。

### OSS デモ（Docker Compose、所要時間 5 分）

すべてのサービス（web / worker / PostgreSQL / Keycloak / MailHog）を Docker Compose で立ち上げる：

```bash
git clone https://github.com/tetsukame/nudge.git
cd nudge
# 既存の .env ファイルがある場合 (開発者) は --env-file 経由でデモ専用設定を読ませる
docker compose --env-file .env.demo up -d --build
# 初めて触る場合 (.env が無い) は --env-file 省略でも OK (compose のデフォルト値が効く)
# docker compose up -d --build
```

> ⚠️ **Windows + Docker Desktop の場合**: `host.docker.internal` を `127.0.0.1` に向ける hosts ファイル設定が必要です。`C:\Windows\System32\drivers\etc\hosts` に以下を追加（管理者権限）：
>
> ```
> 127.0.0.1 host.docker.internal
> ```
>
> Docker Desktop は通常自動で設定しますが、何らかの理由で LAN IP に向いている場合は明示的な書き換えが必要です。

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

- NudgeFlow: http://host.docker.internal:3000
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

## Microsoft Teams 統合（β）

NudgeFlow を Microsoft Teams の Personal Tab として組み込むことができます。Entra SSO → Keycloak Token Exchange で認証を完結させるため、Teams にログイン済みのユーザは追加認証なしで NudgeFlow にアクセスできます。

詳細な手順（Entra アプリ登録 / Keycloak Token Exchange 設定 / sideloading）は [docs/teams-integration.md](docs/teams-integration.md) 参照。

> ⚠️ **β 表記**: 開発環境では Microsoft 365 Developer Program の sandbox 取得制限により実機 Teams での E2E 検証ができていません。仕様通りに実装していますが、初回導入時に動作確認を行い、必要であれば調整してください。

## ドキュメント

- [製品概要 / パンフレット](docs/overview.md)
- [変更履歴 (CHANGELOG)](CHANGELOG.md)
- [DB ERD v0.1 設計書](docs/superpowers/specs/2026-04-11-db-erd-design.md)
- [Microsoft Teams 統合（β）](docs/teams-integration.md)
- 詳細仕様は `docs/superpowers/specs/`、各リリースの実装プランは `docs/superpowers/plans/` 配下

## コントリビューション

バグ報告・機能要望は [GitHub Issues](https://github.com/tetsukame/nudge/issues) へ。プルリクエスト前に [CONTRIBUTING.md](CONTRIBUTING.md) を確認してください。

セキュリティに関する報告は [SECURITY.md](SECURITY.md) を参照（公開 Issue ではなく Security Advisory 経由で）。

## ライセンス

[MIT License](LICENSE)
