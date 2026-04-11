# Nudge

組織内の依頼事項（アンケート・作業依頼）を軽く促して対応状況を可視化する OSS タスク管理ツール。

## このリポジトリの状態

v0.1 では DB スキーマ層のみが実装されています。フロントエンド / API 層は後続プランで追加予定。

## 必要環境

- Node.js 20+
- pnpm 9+
- Docker Desktop（ローカル開発 PG・テストコンテナ用）

## セットアップ

```bash
pnpm install
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
pnpm migrate
```

## テスト

```bash
pnpm test
```

初回はテストコンテナの PG イメージ pull で時間がかかります。

## ディレクトリ構成

| パス | 役割 |
|---|---|
| `migrations/` | 番号付き SQL マイグレーション |
| `src/db.ts` | PG Pool と withTenant ヘルパー |
| `src/migrate.ts` | マイグレーションランナー |
| `tests/schema/` | 各テーブルの構造・制約テスト |
| `tests/rls/` | RLS テナント分離テスト |
| `docs/superpowers/specs/` | 設計ドキュメント |
| `docs/superpowers/plans/` | 実装プラン |

## 設計参考

- [DB ERD v0.1 設計書](docs/superpowers/specs/2026-04-11-db-erd-design.md)
