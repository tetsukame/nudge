# Contributing to Nudge

ご関心ありがとうございます。バグ報告・機能要望・プルリクエストを歓迎します。

## バグ報告 / 機能要望

[GitHub Issues](https://github.com/tetsukame/nudge/issues) で受け付けます。バグ報告には以下の情報を含めてください：

- 再現手順（最小ケース）
- 期待される挙動 / 実際の挙動
- 環境（OS、Node.js / pnpm バージョン、Keycloak / PostgreSQL バージョン）
- 関連するエラーメッセージ・ログ

セキュリティに関する報告は [SECURITY.md](SECURITY.md) の手順に従ってください（公開 Issue では報告しないでください）。

## 開発フロー

### 1. ブランチ命名

```
feat/v<x>-<topic>     # 新機能（例: feat/v016-docker-compose）
fix/<topic>           # バグ修正（例: fix/login-redirect-loop）
refactor/<topic>      # 機能変更を伴わないリファクタ
docs/<topic>          # ドキュメントのみの変更
chore/<topic>         # ビルド・依存関係などの雑務
```

### 2. コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/) 風のプレフィックスを推奨します：

```
feat: 新機能
fix: バグ修正
docs: ドキュメントのみ
refactor: 挙動を変えないリファクタ
test: テストの追加・修正
chore: ビルド・依存関係・設定変更
```

例: `feat(notification): add Slack channel fallback`

### 3. 開発環境のセットアップ

[README.md](README.md) のクイックスタート参照。

### 4. テスト

PR を出す前に以下が green であることを確認してください：

```bash
pnpm typecheck
pnpm test          # unit + schema + RLS（テストコンテナ自動起動）
pnpm test:integration
```

UI 変更を伴う場合はブラウザでも動作確認してください。

### 5. プルリクエスト

PR の本文には以下を含めてください：

- **Summary**: 変更の目的（What ではなく Why）
- **Changes**: 主な変更ファイル・差分の要約
- **Test plan**: 検証方法・手動確認項目のチェックリスト
- 関連する Issue / Notion タスク番号

レビュアーが変更を理解しやすいよう、1 PR あたりの差分は適度な大きさに抑えてください。大きな機能追加は事前に Issue で相談すると進めやすくなります。

## コーディング規約

- **言語**: TypeScript（`strict` モード前提）
- **フォーマッター / リンター**: 現状 prettier / eslint の設定はリポジトリに含めていません。次フェーズで整備予定。当面は周辺コードのスタイルに合わせてください。
- **テスト**: 新機能・バグ修正には可能な限りテストを追加してください
- **コメント**: 「なぜ」を残す。「何をしている」だけのコメントは避けてください
- **マイグレーション**: スキーマ変更は番号付き SQL ファイル (`migrations/NNN_description.sql`) として追加。本番 DB への適用順序を変えないでください

## ライセンス

このプロジェクトに貢献いただいたコードは [MIT License](LICENSE) のもとで公開されます。プルリクエストを送信した時点で、その内容を MIT ライセンスで配布することに同意したものとみなします。
