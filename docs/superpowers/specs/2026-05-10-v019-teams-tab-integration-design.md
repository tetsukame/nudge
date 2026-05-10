# v0.19 Microsoft Teams Tab 統合（β）設計書

- **バージョン**: v0.19
- **タスク**: NDG-26（[Microsoft Teams タブ統合](https://www.notion.so/355062c9be5c81599760dbba25d2cc43)）
- **作成日**: 2026-05-10
- **ステータス**: 未実機検証 / β リリース

## 目的

Nudge を Microsoft Teams 上で Personal Tab として利用できるようにし、Entra SSO 経由で「Teams にログイン済みのユーザは追加認証なしで Nudge にアクセスできる」状態を実現する。

## 背景

利用想定環境では Azure Entra ID で Keycloak のブローカー認証を行うため、Teams SSO（Entra）→ Keycloak の連携経路を確保できる前提。Teams iframe 内での操作は cookie 制限が厳しいため、Token Exchange 方式で JWT 完結型の認証フローを採用する。

## ゴール

1. Teams Personal Tab として Nudge を起動可能にする（manifest 配布、CSP 設定、Tab landing page）
2. Teams JS SDK 経由で Entra トークン取得 → Keycloak Token Exchange で Keycloak セッション確立 → Nudge 通常画面へ遷移
3. 各組織が自前で Entra アプリ登録・Teams app sideloading できる手順書を整備

## β リリース扱いの理由

開発環境で Teams SSO の E2E 検証ができない（M365 Family は Teams 個人版で sideloading 不可、M365 Dev Program は新規申請者の制限で sandbox 取得不可）。manifest と認証コードは Microsoft 公式ドキュメントに従い仕様通りに実装するが、実機での最終確認は導入する組織が初回設定時に実施する流れとする。

## スコープ外

- **Channel/Group Tab**: チーム共有ビューは Nudge 側のテナント単位 URL 設計（`/t/<code>/...`）と相性が悪く、別途設計が必要
- **Bot / Message Extension**: Bot Framework + Azure Bot Service の追加運用が必要、別 NDG 化
- **Adaptive Card 通知強化**: 既存 Teams Webhook の発展形、別 NDG 化（Phase 3）
- **multi-tenant Entra app**: Microsoft の publisher verification が必要で OSS には過剰、各組織 single-tenant per deployment で運用

## 構成

### ファイル構成

```
nudge/
├── docs/
│   └── teams-integration.md          # 新規 (~300 行: 導入手順)
├── docker/
│   └── teams/
│       ├── manifest.template.json    # 新規 (プレースホルダ入りテンプレ)
│       ├── color.png                 # 新規 (192x192 アイコン、カラー)
│       └── outline.png               # 新規 (32x32 アイコン、白アウトライン)
├── scripts/
│   └── build-teams-manifest.ts       # 新規 (.env から実 manifest.json 生成 + zip)
├── src/
│   └── auth/
│       └── teams-token-exchange.ts   # 新規 (Entra→KC トークン交換ロジック)
├── app/
│   └── t/[code]/
│       └── teams/
│           ├── auth/route.ts         # 新規 (POST: Entra トークン受け取り、KC 交換、Nudge セッション発行)
│           └── tab/page.tsx          # 新規 (Teams 用ランディング、Teams JS SDK 初期化)
├── tests/
│   └── unit/
│       └── auth/
│           └── teams-token-exchange.test.ts  # 新規 (fetch mock テスト)
├── middleware.ts                     # 修正 (CSP frame-ancestors を Teams 許可)
├── README.md                         # 修正 (Teams 統合 (β) セクション追加)
└── package.json                      # 修正 (@microsoft/teams-js を依存追加)
```

## 認証フロー（経路A: Keycloak Token Exchange）

```
1. Teams 上で Personal Tab を開く
   ↓
2. https://<nudge-domain>/t/<code>/teams/tab がロードされる
   ↓
3. Teams JS SDK 初期化:
   await microsoftTeams.app.initialize();
   ↓
4. Entra トークン取得:
   const entraToken = await microsoftTeams.authentication.getAuthToken();
   ↓
5. POST /t/<code>/teams/auth { entraToken } で Nudge サーバへ
   ↓
6. Nudge サーバ: Keycloak Token Exchange エンドポイント呼び出し
   POST <kc>/protocol/openid-connect/token
     grant_type=urn:ietf:params:oauth:grant-type:token-exchange
     subject_token=<entra_token>
     subject_issuer=<entra_idp_alias>
     subject_token_type=urn:ietf:params:oauth:token-type:access_token
     client_id=<nudge-web>
     client_secret=<...>
   ↓
7. KC が Entra IdP broker 経由で KC アクセストークン + ID トークン発行
   ↓
8. Nudge サーバ: 既存 callback と同じ流れ:
   - jitUpsertUser でユーザ upsert
   - sealSession で nudge_session cookie 発行
   - 200 OK 返却
   ↓
9. クライアント: window.location.replace('/t/<code>/') で通常画面へ
```

### 経路 A を採用した理由

- **B（silent OIDC）**: iframe 内 cookie 問題（Chrome 3PCD / Safari ITP で `Secure` cookie が iframe で送信されない）の対処が複雑。Storage Access API or Partitioned Cookie 対応が必要
- **C（Entra 直接認証）**: KC を bypass、Nudge の認証ソースが分裂し既存の user_role / 監査ログとの整合性が崩れる
- **A**: JWT 完結で cookie 不要、認証ソースは KC 一本のまま、Microsoft 公式の OIDC 標準パターン

## Keycloak 側の前提条件（導入時設定）

| 設定項目 | 値 |
|---|---|
| Keycloak 起動オプション | `--features=token-exchange` 必須 |
| Entra IdP broker | 作成済み、`alias` を `.env` の `KC_ENTRA_IDP_ALIAS` に記載 |
| IdP broker → Stored Tokens | ON |
| 同 → Sync Mode | `import` |
| Client `nudge-web` の fine-grained permission | `token-exchange` を IdP broker に対して許可 |
| Service account roles | 既存（`view-users`, `view-realm`, `view-groups`） |

これらは Keycloak 26 の標準機能で、preview 扱いだが安定して使える。具体的な設定手順は `docs/teams-integration.md` に記載。

## Entra アプリ登録（導入時設定）

各組織が自分の Entra テナントで以下を登録：

1. **Application registration**: 名前 "Nudge"、redirect URI 不要（Tab はトークン flow を使わない）
2. **Application ID URI**: `api://<nudge-domain>/<entra-app-id>` を設定
3. **Expose an API → Add a scope**: `access_as_user`、admin + user consent
4. **Authorized client applications**: Microsoft Teams の client ID を pre-authorize
   - `1fec8e78-bce4-4aaf-ab1b-5451cc387264` (Teams mobile/desktop)
   - `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` (Teams web)
5. **API permissions**: `Microsoft Graph > openid, profile, email, User.Read` を追加 + admin consent
6. **Application ID** を `.env` の `ENTRA_APP_ID` に記載

## manifest.template.json

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/teams/v1.19/MicrosoftTeams.schema.json",
  "manifestVersion": "1.19",
  "version": "0.19.0",
  "id": "{{TEAMS_APP_ID}}",
  "developer": {
    "name": "{{ORG_NAME}}",
    "websiteUrl": "https://{{NUDGE_DOMAIN}}",
    "privacyUrl": "https://{{NUDGE_DOMAIN}}/privacy",
    "termsOfUseUrl": "https://{{NUDGE_DOMAIN}}/terms"
  },
  "name": { "short": "Nudge", "full": "Nudge - 業務依頼管理" },
  "description": {
    "short": "組織内の業務依頼を可視化・促進する OSS タスク管理ツール",
    "full": "Nudge は組織内の依頼事項（アンケート・作業依頼）を可視化し、未対応の催促を軽量化する OSS タスク管理ツールです。"
  },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#3b82f6",
  "staticTabs": [
    {
      "entityId": "nudge-home",
      "name": "依頼",
      "contentUrl": "https://{{NUDGE_DOMAIN}}/t/{{NUDGE_TENANT_CODE}}/teams/tab",
      "websiteUrl": "https://{{NUDGE_DOMAIN}}/t/{{NUDGE_TENANT_CODE}}/",
      "scopes": ["personal"]
    }
  ],
  "permissions": ["identity"],
  "validDomains": ["{{NUDGE_DOMAIN}}"],
  "webApplicationInfo": {
    "id": "{{ENTRA_APP_ID}}",
    "resource": "api://{{NUDGE_DOMAIN}}/{{ENTRA_APP_ID}}"
  }
}
```

プレースホルダ：
- `{{TEAMS_APP_ID}}`: 任意の GUID（Teams が識別に使う、Entra app ID とは別物）
- `{{ORG_NAME}}`: 表示用組織名
- `{{NUDGE_DOMAIN}}`: 公開ドメイン（例: `nudge.example.com`）
- `{{NUDGE_TENANT_CODE}}`: Nudge のテナントコード（例: `dev`）
- `{{ENTRA_APP_ID}}`: Entra アプリ登録の Application ID

`scripts/build-teams-manifest.ts` で `.env` の値に置換し、アイコン2枚と zip化して `nudge-teams-app.zip` を生成。

## CSP frame-ancestors の更新

`middleware.ts` で全レスポンスに以下のヘッダ追加：

```
Content-Security-Policy: frame-ancestors 'self' teams.microsoft.com *.teams.microsoft.com *.skype.com *.cloud.microsoft *.microsoftonline.com
```

これにより Teams iframe からのアクセスが許可される。Nudge を別ドメインで配信する逆プロキシ環境では、ホスト側で同等のヘッダを設定する必要があるが、Nudge 自身も入れておけば多くのケースをカバーできる。

## Token Exchange ロジック（コア実装）

`src/auth/teams-token-exchange.ts`：

```ts
export type TokenExchangeConfig = {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  entraIdpAlias: string;
};

export type TokenSet = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export class TokenExchangeError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TokenExchangeError';
  }
}

export async function exchangeEntraTokenForKcToken(
  entraToken: string,
  config: TokenExchangeConfig,
): Promise<TokenSet> { ... }
```

- Endpoint: `${issuerUrl}/protocol/openid-connect/token`
- Body: form-urlencoded with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` etc.
- Error handling: 401 (invalid Entra token) / 403 (KC permission missing) / 5xx (KC down) を区別
- ID トークンを検証して claims 取得 → callback と同じく `jitUpsertUser` で users テーブルに upsert

## Tab landing page (`app/t/[code]/teams/tab/page.tsx`)

```tsx
'use client';
// 簡略版
import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';

export default function TeamsTabPage() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const teams = await import('@microsoft/teams-js');
        await teams.app.initialize();
        const token = await teams.authentication.getAuthToken();
        const res = await fetch(`/t/${code}/teams/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entraToken: token }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Auth failed: ${res.status}`);
        }
        router.replace(`/t/${code}/`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Authentication failed');
      }
    })();
  }, [code, router]);

  if (error) return <div>認証エラー: {error}</div>;
  return <div>Nudge にサインイン中...</div>;
}
```

## Auth route (`app/t/[code]/teams/auth/route.ts`)

POST handler：

1. body から entraToken 取得
2. tenant 解決 → KC config 取得
3. `exchangeEntraTokenForKcToken` 呼び出し
4. ID トークン検証 → claims 取り出し
5. `jitUpsertUser` でユーザ upsert
6. `sealSession` で nudge_session cookie 発行
7. 200 OK { ok: true } 返却

エラー時は 4xx/5xx + JSON エラー本文。

## テスト方針

- **`tests/unit/auth/teams-token-exchange.test.ts`**: `fetch` mock で正常系 / 401 / 403 / 5xx ケース
- **既存テスト regression なし**: typecheck + 326 unit tests pass
- **β: 実機検証なし**: PR 本文に「未実機 / 導入する組織が初回確認」を明記

## ドキュメント方針（`docs/teams-integration.md`）

セクション構成：

1. 全体像とアーキテクチャ図
2. 前提条件（Keycloak 26、Entra テナント admin 権限、Nudge HTTPS 公開）
3. Keycloak 側の設定（Token Exchange 有効化、Entra IdP broker、permissions）
4. Entra アプリ登録（Application registration、Expose an API、Pre-authorized clients、API permissions）
5. `.env` 追記項目（`ENTRA_APP_ID`、`KC_ENTRA_IDP_ALIAS`）
6. Teams app パッケージ生成（`scripts/build-teams-manifest.ts` 実行）
7. Teams admin center で sideloading 有効化
8. ユーザでの sideload と動作確認
9. トラブルシューティング（よくあるエラーと対処）

## 完了条件

- 上記ファイルが main にマージ済み
- typecheck clean、既存 + 新規 token-exchange テスト全 pass
- README に「Microsoft Teams 統合（β）」項目追加、`docs/teams-integration.md` リンク
- PR 本文に β 表記、実機検証は導入する組織が初回確認する旨を明記

## オープンクエスチョン（実装中に解決）

- アイコン作成: 自前で SVG 起こすか lucide のロゴアイコンを変換、または placeholder PNG → 別 PR で正式版差し替え
- `build-teams-manifest.ts` の zip 化: `archiver` パッケージを依存追加するか、tar コマンド直叩き等で済ませるか
- middleware の CSP: 既存設定があれば差し替え、新規ならどの場所に配置するか
- token-exchange エンドポイントが返すトークンの ID Token 検証: 既存の `auth/oidc-client.ts` の機構を流用できるか確認

## 関連リンク

- 親タスク: [NDG-26 Microsoft Teams タブ統合](https://www.notion.so/355062c9be5c81599760dbba25d2cc43)
- Microsoft Teams SSO: https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview
- Keycloak Token Exchange: https://www.keycloak.org/securing-apps/token-exchange
