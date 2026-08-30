# 汎用 OIDC プロバイダの設定

Nudge は OIDC 準拠なら任意の IdP を tenant ごとに設定できる (NDG-98 Phase 1)。設定は `/t/<code>/admin/settings/auth` (tenant_admin のみ) から行い、DB (`tenant_auth_config`) に保存される。

**未設定の場合**は環境変数 `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` と `tenant.keycloak_issuer_url` を使うフォールバック動作になる (後方互換)。

## 疎通確認済み構成

| IdP | 種別 | 検証環境 |
|---|---|---|
| [Keycloak](https://www.keycloak.org/) 26 | keycloak / generic-oidc | dev |
| [Pocket ID](https://pocket-id.org/) | generic-oidc | dev (2026-08-30) |

未検証だが同様に動くはず: Authentik / Authelia / Microsoft Entra ID / Google Workspace。

## 設定の 4 要素

| 項目 | 内容 |
|---|---|
| **Provider Type** | `keycloak` / `generic-oidc` (現在の実装は挙動同じ、将来分岐する余地) |
| **Issuer URL** | `.well-known/openid-configuration` を **付けない** ベース URL |
| **Client ID / Secret** | IdP 側で発行。`tenant_auth_config.client_secret_encrypted` は AES-256-GCM 暗号化 |
| **Claim Mapping** | JSONB。未設定なら email / name / preferred_username のデフォルト動作 (詳細: [claim-mapping.ts](../../src/domain/auth/claim-mapping.ts)) |

## 実例: Keycloak

### Issuer URL
```
http://kc.example.com/realms/<realm-name>
```
- realm 名を末尾に付ける。付け忘れると Discovery で `Realm does not exist` が返る
- Discovery 実 URL は `http://kc.example.com/realms/<realm-name>/.well-known/openid-configuration`

### Client 作成 (KC admin console)
1. **Clients → Create client**
2. Client ID: 任意 (例: `nudge-web`)
3. Client authentication: **On** (confidential にする)
4. Authorization: Off
5. Standard flow / Direct access grants: **On**
6. Valid Redirect URIs: `http://localhost:3000/t/<code>/auth/callback` (完全一致)
7. Save → **Credentials** タブに Client Secret

### groups / roles を Nudge role にマッピング
KC の **Client scopes → nudge-web-dedicated (or your client scope)** で `groups` mapper を追加 (Mapper type: Group Membership、Token Claim Name: `groups`)。KC は `groups` claim を `/group-name` 形式で返すので Claim Mapping にはスラッシュ付きで書く:

```json
{
  "roles": {
    "claim": "groups",
    "map": {
      "/admins": "tenant_admin",
      "/managers": "manager",
      "/requesters": "tenant_wide_requester"
    }
  }
}
```

## 実例: Pocket ID

### Issuer URL
```
https://<pocket-id-host>
```
末尾スラッシュなし。Pocket ID の Discovery Endpoint はホスト直下 (`.well-known/openid-configuration`)。

### Client 作成 (Pocket ID admin panel)
1. **OIDC Clients → Add OIDC Client**
2. Name: `Nudge (dev)` など
3. Callback URLs: `http://localhost:3000/t/<code>/auth/callback` (末尾スラッシュ有無で **完全一致**、複数登録可)
4. Public Client: **Off** (Nudge は confidential client / client_secret 前提)
5. PKCE: **On** (推奨)
6. Save → Client ID / Client Secret をコピー

### アクセス制御 (Pocket ID 特有、重要)
Pocket ID は **Allowed User Groups** を空にすると誰も入れない。client 詳細ページ末尾で:
1. User Group 作成 (例: `nudge-users`)
2. その group をログインさせたい User に割り当て
3. Client の **Allowed User Groups** に `nudge-users` を追加

未設定だとログイン試行時に `access_denied: You are not allowed to access this service.` が返る。

### Nudge 側の設定
```
Issuer URL:    https://<pocket-id-host>
Client ID:     (Pocket ID からコピー)
Client Secret: (Pocket ID からコピー)
Claim mapping: {}
```

Pocket ID は claim mapping なしでも `email` / `name` が取れる。groups マッピングは Pocket ID の Custom Claims 機能で `groups` claim を追加してから対応可能。

## Gotcha

### 1. SSRF ガードで private IP が弾かれる
社内 KC / Pocket ID を private IP (192.168.x.x 等) でホストしている場合、`.env` に許可リストを追加:

```
SAFE_URL_HOST_ALLOWLIST=192.168.1.105,id.internal.example.com
```

追加後は dev サーバー再起動が必要 (Next.js は起動時のみ env を読む)。詳細: [safe-url.ts](../../src/lib/safe-url.ts)

### 2. Callback URL の完全一致
IdP 側の Callback URL は Nudge が送るものと **完全一致** 必須。末尾スラッシュ / ポート番号 / プロトコル (http/https) を細かく確認。Pocket ID は `*` ワイルドカード対応、KC は不可。

### 3. tenant_admin が締め出される罠
既存の tenant_admin ユーザーは KC 経由でしか作られていない。汎用 OIDC に切替えて別 IdP でログインすると、`users.oidc_sub` が違うため **新規ユーザーとして作成** され、role も所属も無い。この状態で認証設定を書き換えると管理 UI に戻れなくなる。

**復旧経路 A: 緊急ローカル管理者ログイン (推奨、NDG-118)**

1. `.env` に `EMERGENCY_LOCAL_LOGIN=true` を追加 → dev サーバー再起動
2. ブラウザで `http://localhost:3000/t/<code>/rescue-login` にアクセス
3. Platform admin の email / password (`/root/login` で使うのと同じ) を入力 → 「緊急ログイン」
4. 緊急 tenant_admin ユーザーが自動作成 (`keycloak_sub = 'emergency:<email>'`) + tenant_admin ロール付与
5. `/admin/settings/auth` にリダイレクトされるので設定を修正
6. 復旧作業が終わったら `EMERGENCY_LOCAL_LOGIN=false` に戻し、サーバー再起動

audit_log に `login.emergency_local` として記録される。

**復旧経路 B: SQL 直接削除**

```
docker run --rm postgres:17-alpine psql "postgresql://dbadmin:...@<host>:5432/nudge" \
  -c "DELETE FROM tenant_auth_config WHERE tenant_id = '<uuid>';"
```

削除すると env fallback (KC) に戻る。DB 直接アクセスできる場合はこちらが最短。

### 4. Discovery URL の trailing slash
openid-client の `Issuer.discover(url)` は `url + "/.well-known/openid-configuration"` を叩く。issuer URL に既にスラッシュが付いていると `//..` になり Pocket ID などがハングする可能性。**末尾スラッシュなしを推奨**。

## 動作の流れ (参考)

1. `/t/<code>/login` → session-guard は不要 (public route)
2. tenant を resolve、`tenant_auth_config` を読み込む
3. [getAuthProvider](../../src/auth/provider/index.ts) が provider_type と config に応じて `KeycloakAdapter` / `GenericOidcAdapter` を返す
4. `AuthProvider.getAuthorizationUrl` で IdP の authorize endpoint に redirect
5. IdP 認証後、`/t/<code>/auth/callback` に戻る
6. `AuthProvider.handleCallback` で token 交換 → claim 取得
7. [mapClaims](../../src/domain/auth/claim-mapping.ts) で claim → user 属性 / role にマッピング
8. `jitUpsertUser` で `users` テーブル upsert
9. `syncUserRolesFromIdP` で `user_role` テーブル差分同期 (roles.map の値集合内のみ)
10. session cookie 発行 → `returnTo` に redirect

## 関連
- [tenant_auth_config スキーマ (migration 057)](../../migrations/057_tenant_auth_config.sql)
- [RLS ポリシー修正 (migration 058)](../../migrations/058_tenant_auth_config_rls_fix.sql)
- [観測性: ログ](../ops/logging.md) / [メトリクス](../ops/metrics.md)
