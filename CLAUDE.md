# Nudge プロジェクト

## 要件定義書
https://www.notion.so/tkame/33f062c9be5c812eb1cfc8210bcde3e0

## インフラ構成
- PostgreSQL: 192.168.1.104
- Keycloak: 192.168.1.105

## 技術スタック
- フロント: Next.js
- DB: PostgreSQL 17（RLS によるマルチテナント）
- 認証: Keycloak 26（OIDC）
- 通知: メール → Teams → Slack
