# Microsoft Teams 統合（β）

Nudge を Microsoft Teams の Personal Tab として組み込み、Entra SSO 経由でログインなしに利用できるようにするための導入手順。

> ⚠️ **β リリース**: 開発環境では Microsoft 365 Developer Program の sandbox 取得制限により、実機 Teams での E2E 検証が完了していません。仕様通りに実装していますが、初回導入時に Teams 環境で動作確認を行い、必要であれば調整してください。問題があれば [GitHub Issues](https://github.com/tetsukame/nudge/issues) へ報告ください。

---

## アーキテクチャ概要

```
┌────────────────┐       ┌────────────────┐       ┌────────────────┐
│ Microsoft      │       │ Nudge web      │       │ Keycloak       │
│ Teams (iframe) │       │ (Next.js)      │       │ (IdP broker:   │
│                │       │                │       │  Entra)        │
└───────┬────────┘       └───────┬────────┘       └───────┬────────┘
        │                        │                        │
        │ 1. Personal Tab を開く │                        │
        │   /teams/tab           │                        │
        ├───────────────────────>│                        │
        │                        │                        │
        │ 2. Teams JS SDK init   │                        │
        │<───────────────────────┤                        │
        │                        │                        │
        │ 3. getAuthToken()      │                        │
        │   → Entra access token │                        │
        ├───────────────────────>│                        │
        │                        │                        │
        │ 4. POST /teams/auth    │                        │
        │   { entraToken }       │                        │
        │                        │                        │
        │                        │ 5. Token Exchange      │
        │                        │   subject_token=entra  │
        │                        ├───────────────────────>│
        │                        │                        │
        │                        │ 6. KC が IdP broker    │
        │                        │   経由で Entra ユーザを│
        │                        │   検証 → KC アクセス   │
        │                        │   トークン発行         │
        │                        │<───────────────────────┤
        │                        │                        │
        │                        │ 7. jitUpsertUser →     │
        │                        │   sealSession →        │
        │                        │   nudge_session cookie │
        │                        │   発行                 │
        │ 8. 200 OK + Set-Cookie │                        │
        │<───────────────────────┤                        │
        │                        │                        │
        │ 9. /t/<code>/ へ遷移   │                        │
        ├───────────────────────>│                        │
        │   通常の Nudge 画面    │                        │
        │<───────────────────────┤                        │
```

## 前提条件

- **Keycloak 26 以降**（`token-exchange` 機能を有効化）
- **Microsoft Entra ID（Azure AD）テナント**（管理者権限）
- **Microsoft 365 Business** 以上または **Teams admin center にアクセス可能な業務 Teams 環境**
  - M365 Family（個人版 Teams）では sideloading 不可
- **Nudge を HTTPS で公開**（Teams は `https://` 必須）

## ステップ 1: Keycloak 側の設定

### 1.1 Token Exchange 機能を有効化

Keycloak 起動時のオプションに `--features=token-exchange` を追加。
docker-compose.yml の場合：

```yaml
keycloak:
  command: start-dev --import-realm --features=token-exchange
```

本番起動 (`start` モード) でも同様に `--features=token-exchange` を渡す。

### 1.2 Entra IdP broker を作成

Keycloak admin console（`http://localhost:8080/admin/`）で：

1. 対象 realm（例: `nudge`）を選択
2. **Identity Providers** → **Add provider** → **OpenID Connect v1.0**
3. 以下を設定：

| 項目 | 値 |
|---|---|
| Alias | `entra`（任意の文字列、`.env` の `KC_ENTRA_IDP_ALIAS` と一致させる） |
| Display name | `Microsoft Entra ID` |
| Discovery endpoint | `https://login.microsoftonline.com/<entra-tenant-id>/v2.0/.well-known/openid-configuration` |
| Client ID | Entra アプリ登録の Application ID（次セクション参照） |
| Client Secret | Entra アプリ登録で発行した secret |
| Default scopes | `openid profile email` |

4. **Save**

### 1.3 IdP broker の Stored Tokens を ON

作成した IdP broker の **Settings** タブで：

- **Trust Email**: ON（Entra 検証済みメールを Keycloak でも信頼）
- **Stored Tokens**: ON（Token Exchange で必要）
- **Sync Mode**: `import`（初回ログイン時に Keycloak ユーザを作成）

### 1.4 Client `nudge-web` に token-exchange 権限付与

1. **Clients** → `nudge-web` を選択
2. **Permissions** タブで **Permissions Enabled** を ON
3. 表示されたリストから **token-exchange** を選択
4. **Add policy** で以下を作成：
   - Type: **Client**
   - Clients: `nudge-web`
5. Save

これにより `nudge-web` client が IdP broker（`entra`）からのトークンを subject_token として受け取れる。

詳細は Keycloak 公式: https://www.keycloak.org/securing-apps/token-exchange

## ステップ 2: Entra アプリ登録

Entra admin center（https://entra.microsoft.com/）で：

### 2.1 Application registration

1. **Identity** → **Applications** → **App registrations** → **New registration**
2. Name: `Nudge`
3. Supported account types: **Accounts in this organizational directory only (single tenant)**
4. Redirect URI: 設定不要（Tab はトークンフロー使用なし）
5. **Register**

作成後の **Overview** タブから **Application (client) ID** を控える → これが `ENTRA_APP_ID`。

### 2.2 Application ID URI

1. **Expose an API** タブ
2. **Application ID URI** で **Set** をクリック
3. デフォルトの `api://<client-id>` を、`api://<NUDGE_DOMAIN>/<client-id>` に変更

例: `api://nudge.example.com/12345678-1234-1234-1234-123456789abc`

### 2.3 API スコープ追加

同じ **Expose an API** タブで：

1. **Add a scope**
2. 以下を入力：
   - Scope name: `access_as_user`
   - Who can consent: **Admins and users**
   - Admin consent display name: `Access Nudge`
   - Admin consent description: `Allows the app to access Nudge as the signed-in user.`
   - User consent display name: `Access Nudge`
   - User consent description: `Allows Nudge to act on your behalf.`
3. **Add scope**

### 2.4 Pre-authorized client applications

同じ **Expose an API** タブで **Add a client application**：

以下の Microsoft Teams client ID を順番に追加（それぞれの行で `access_as_user` スコープにチェック）：

| Client ID | 説明 |
|---|---|
| `1fec8e78-bce4-4aaf-ab1b-5451cc387264` | Microsoft Teams mobile / desktop |
| `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` | Microsoft Teams web |

これにより、Teams から SSO トークンを取得する際にユーザの追加 consent が不要になる。

### 2.5 API permissions

1. **API permissions** タブ
2. **Add a permission** → **Microsoft Graph** → **Delegated permissions**
3. 以下を追加：
   - `openid`
   - `profile`
   - `email`
   - `User.Read`
4. **Add permissions**
5. **Grant admin consent for <tenant>**（管理者権限要）

### 2.6 Client secret

Keycloak の IdP broker で使うため：

1. **Certificates & secrets** タブ
2. **New client secret**
3. Description: `KC IdP broker`、Expires: 24 months（任意）
4. **Add**
5. 表示された **Value** を控える（一度しか表示されない）→ Keycloak の IdP broker 設定の Client Secret に貼り付け

## ステップ 3: Nudge 側の設定

### 3.1 環境変数

`.env` に以下を追加：

```bash
# Keycloak の Entra IdP broker の alias (ステップ 1.2 で設定したもの)
KC_ENTRA_IDP_ALIAS=entra
```

### 3.2 Teams app パッケージ生成用の env vars

`build-teams-manifest` スクリプト実行時に以下が必要：

```bash
# Teams app 識別用 GUID (Entra アプリ ID とは別物、新規生成)
TEAMS_APP_ID=$(uuidgen)  # macOS/Linux
# または PowerShell: [guid]::NewGuid().ToString()

# ステップ 2.1 で控えた Application (client) ID
ENTRA_APP_ID=12345678-1234-1234-1234-123456789abc

# 公開ドメイン (https:// 抜き)
NUDGE_DOMAIN=nudge.example.com

# Nudge のテナントコード
NUDGE_TENANT_CODE=dev

# manifest の "developer.name" に出る組織名
ORG_NAME='Example Org'
```

これらを `.env` に書くか、shell で export してからスクリプトを実行する。

## ステップ 4: Teams app パッケージ生成

```bash
pnpm build:teams-manifest
```

成功すると：
- `docker/teams/manifest.json` （展開された manifest）
- `dist/nudge-teams-app.zip` （sideloading 用パッケージ、`manifest.json` + `color.png` + `outline.png`）

icon は β リリースでは 1x1 px placeholder。本番運用では適切な PNG（color: 192x192、outline: 32x32 透明背景）に差し替えてください。

## ステップ 5: Teams admin center で custom apps を許可

1. https://admin.teams.microsoft.com/ にアクセス（管理者）
2. **Teams apps** → **Setup policies** → **Global (Org-wide default)**
3. **Upload custom apps** を **On**
4. **Save**

すでに有効なら何もしなくて OK。

## ステップ 6: Nudge アプリを Teams に sideload

### ユーザー個人での sideload

1. Teams を開く
2. **Apps** → 左メニュー **Manage your apps** → **Upload an app**
3. **Upload an app to your org's app catalog**（管理者の場合）または **Upload for me**（個人の場合）
4. `dist/nudge-teams-app.zip` を選択
5. **Add** で自分の Teams に追加

### 動作確認

- Teams 左サイドバーに **Nudge** アイコンが追加される
- クリックすると「依頼」タブが開き、自動的に「Nudge にサインイン中...」と表示
- 数秒後に Nudge の通常画面（依頼一覧等）に遷移すれば成功

## トラブルシューティング

### "Authentication failed" / KC Token Exchange が 401

- **原因**: Entra アプリの Pre-authorized clients に Teams client ID が登録されていない、または scope `access_as_user` が exposed されていない
- **対処**: ステップ 2.3 / 2.4 を再確認

### Token exchange が 403

- **原因**: Keycloak 側で client `nudge-web` に token-exchange 権限が付与されていない、または IdP broker の Stored Tokens が OFF
- **対処**: ステップ 1.3 / 1.4 を再確認

### "KC_ENTRA_IDP_ALIAS is not configured"

- **原因**: Nudge の `.env` に `KC_ENTRA_IDP_ALIAS` が設定されていない
- **対処**: ステップ 3.1 を実施 → Nudge web 再起動

### Teams で「This app could not be installed」

- **原因**: Teams admin center で custom apps が無効、または manifest.json に schema 違反
- **対処**: ステップ 5 を再確認、`docker/teams/manifest.json` を Teams App Studio などで validate

### iframe が真っ白 / CSP エラー

- **原因**: Nudge 側の CSP が Teams を許可していない（ローカル開発で middleware を bypass している場合等）
- **対処**: middleware が動いているか確認、ブラウザ DevTools の console で CSP エラーメッセージ確認

## 制限事項（β）

- **未実機検証**: Microsoft 365 Family は Teams 個人版で sideloading 不可、Microsoft 365 Developer Program は新規申請者の制限で sandbox 取得不可のため、実機 E2E は導入する組織が初回確認する流れ
- **Channel Tab / Bot 未対応**: Personal Tab のみ。Channel 共有ビューや Bot 機能は別 NDG として切り出し
- **Adaptive Card 通知未強化**: 既存 Teams Webhook 通知を rich card 化する Phase 3 は別 NDG
- **アイコン**: 1x1 placeholder。本番では組織のロゴに差し替え推奨

## 参考リンク

- [Microsoft Teams app manifest schema](https://learn.microsoft.com/en-us/microsoftteams/platform/resources/schema/manifest-schema)
- [Microsoft Teams SSO overview](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview)
- [Keycloak Token Exchange](https://www.keycloak.org/securing-apps/token-exchange)
- [Microsoft Entra ID app registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)
