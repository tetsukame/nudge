# SCIM 2.0 プロビジョニング (受信)

Nudge は SCIM 2.0 Service Provider として、外部 IdP からユーザー情報の push を受け取れる (NDG-115)。IdP が真実ソース、Nudge が追従する構成。

**未設定なら SCIM endpoint はトークン無しリクエストに 401 を返す**。tenant_admin が明示的にトークンを発行しない限り誰も書き込めない。

## いつ使うか

- 人事が Entra ID / Google Workspace / Okta 等でユーザー / 組織を管理
- 退職者・異動を IdP 側で処理 → Nudge にリアルタイムに反映したい
- 既存の [KC pull sync](../../src/sync/keycloak-source.ts) と併存可 (どちらか / 両方)

## トークン発行

CLI で発行する。平文は **stdout に 1 度だけ** 表示され、以降は bcrypt hash のみ保存。

```
pnpm scim:rotate-token dev
```

出力例:

```
✅ SCIM token issued for tenant "dev" (開発組織)

   SCIM base URL:
     https://<your-nudge-host>/t/dev/scim/v2

   Bearer token (record this now, it will not be shown again):
     xxx...(43 char base64url)...xxx

   Test with:
     curl -H "Authorization: Bearer xxx..." https://<host>/t/dev/scim/v2/ServiceProviderConfig
```

再実行するとローテートで置換され、旧トークンは即座に失効する。

## エンドポイント

| URL | Method | 用途 |
|---|---|---|
| `/t/<code>/scim/v2/ServiceProviderConfig` | GET | IdP の疎通確認 |
| `/t/<code>/scim/v2/Users` | GET | `?filter=userName eq "..."` で dedup 検索 |
| `/t/<code>/scim/v2/Users` | POST | 新規ユーザー |
| `/t/<code>/scim/v2/Users/{id}` | GET | 単一取得 |
| `/t/<code>/scim/v2/Users/{id}` | PUT | 全体置換 |
| `/t/<code>/scim/v2/Users/{id}` | PATCH | 部分更新 (特に `active` toggle) |

すべて `Authorization: Bearer <token>` ヘッダ必須。SCIM error response (schemas: `[urn:ietf:params:scim:api:messages:2.0:Error]`) 準拠。

## Groups は未対応

現時点で `/Groups` は未実装 (NDG-116 で追加予定)。組織 (org_unit) 同期は KC pull sync 経由でお願いします。

## ユーザー無効化の効果

`PATCH /Users/{id}` with `active: false` → `users.status='inactive'`:
- 該当ユーザーは即ログイン不可 (session-guard が inactive をリジェクト)
- 既存 session 中でも次リクエストで 401 → cookie が失効表示になる
- 既に発行済み依頼・履歴は残る

## IdP 側設定例

### Entra ID
1. Enterprise Applications → Provisioning
2. Provisioning Mode: Automatic
3. Tenant URL: `https://<host>/t/<code>/scim/v2`
4. Secret Token: 上記 CLI 出力の値
5. Test Connection → OK なら Mappings を確認して Save

### SCIM for Keycloak プラグイン
1. KC realm に scim-for-keycloak plugin をデプロイ
2. Realm Settings → SCIM → Add SCIM Provider
3. Base URL: `https://<host>/t/<code>/scim/v2`
4. Authentication: Bearer / Token: 上記 CLI 出力

## トラブルシュート

- **すべて 401**: token を CLI で再発行して IdP 側に貼り直す (既存 token は失効)
- **filter で見つからない**: SCIM の filter は `userName eq "..."` 形式のみサポート。他は無視されて全件を返す (IdP は Resources[] を自前で確認して dedup する)
- **PATCH で active toggle 以外反映されない**: 意図的。他の Op は 200 で受けるが no-op (IdP フローを止めないため)。今後拡張予定
- **SCIM ログを追いたい**: [構造化ログ](../ops/logging.md) 経由で pino に流れる。`logger.info` に `tenantId / userId / externalId` が付与される
