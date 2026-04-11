# Nudge v0.2 アプリ基盤設計

- 作成日: 2026-04-11
- 対象: v0.1 DB ERD の上に構築する Next.js 認証基盤
- ステータス: ドラフト
- 前提: [v0.1 DB ERD 設計書](2026-04-11-db-erd-design.md)

## 1. 目的とスコープ

Nudge v0.2 は、Next.js アプリケーションの基盤を構築する。具体的には:

- Next.js App Router のスキャフォールド
- Keycloak OIDC 認証（テナントごとの Realm 対応）
- パスプレフィックスによるテナント解決
- 非 superuser DB 接続（v0.1 の RLS を実質的に効かせる）
- セッション管理（暗号化 Cookie）
- JIT（Just-In-Time）ユーザープロビジョニング
- 認証フローのテスト基盤

### スコープ外（後続プラン）

- **v0.3**: Keycloak Admin API ポーリングによるユーザー同期（非ログイン職員への事前プロビジョニング）
- **v0.3+**: 組織階層の同期（Keycloak グループ → `org_unit`）
- **v0.4+**: ドメインロジック（依頼作成、ターゲット展開、ステータス遷移、転送、代理完了）
- **v0.4+**: UI 本体（依頼一覧、依頼作成、進捗ダッシュボード）
- **v0.5+**: 通知ワーカー

## 2. アーキテクチャ上の決定

### 2.1 Next.js ルーティング

- **App Router** を採用する（`app/` ディレクトリ）
- Pages Router は使わない
- テナント配下のすべてのページは `app/t/[code]/...` 以下に置く
- 認証不要のルートは `app/api/health` のみ（v0.2 時点）

### 2.2 認証ライブラリ

- **生の `openid-client`** を使用する（Auth.js / next-auth は使わない）
- 理由: 1 テナント = 1 Keycloak Realm で issuer が動的に決まる要件に対し、Auth.js の「設定時に issuer を固定」前提と衝突するため。ライブラリと戦うより自前で書いた方が短く読みやすい
- `openid-client` の `Issuer.discover()`, `client.authorizationUrl()`, `client.callback()` を使ってフローを実装

### 2.3 DB 接続戦略（2 プール構成）

v0.1 のコードレビューで指摘された「superuser 接続だと FORCE RLS でもバイパスされる」問題を解決する。

**プール:**

| 名前 | 環境変数 | ロール | 用途 |
|---|---|---|---|
| adminPool | `DATABASE_URL_ADMIN` | PG superuser or DDL 権限持ち | マイグレーション実行、テナント作成、`tenant` テーブル参照（RLS 外） |
| appPool | `DATABASE_URL_APP` | `nudge_app` LOGIN | 通常リクエスト処理、`withTenant` 経由の全クエリ |

**マイグレーション 020 で `nudge_app` に LOGIN を付与する:**

```sql
-- migrations/020_nudge_app_login.sql
ALTER ROLE nudge_app LOGIN;
-- PASSWORD は migration では設定せず、初期化時に手動で設定する
-- （パスワードをマイグレーションにハードコードしないため）
```

初期化手順:
```bash
psql -h host -U postgres -d nudge -c "ALTER ROLE nudge_app PASSWORD '<secret>'"
```

**不変条件:**
- 通常リクエスト処理での全 DB 書き込みは `withTenant(appPool, tenantId, fn)` 経由
- `tenant` テーブルの参照のみ例外的に adminPool を使う（テナント解決時、セッション未確立なので appPool の `app.tenant_id` が立てられない）

### 2.4 テナント解決

- URL パスプレフィックス方式: `/t/<tenant.code>/...`
- v0.1 の設計書で確定済み、本 v0.2 でもこれを踏襲
- `middleware.ts` が URL からコードを抽出
- `src/tenant/resolver.ts` が `SELECT * FROM tenant WHERE code = $1` を adminPool で実行
- **LRU キャッシュ**（最大 100 件、TTL 5 分）で DB 往復を減らす
- 未存在のテナントコード → 404

### 2.5 セッション管理

- **iron-session** を使う（暗号化 Cookie、サーバーサイドストア不要）
- Redis も DB セッションテーブルも使わない（セルフホスト OSS の運用負担を最小化）
- Cookie 名: `nudge_session`
- 属性: `httpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/t/<code>/`
- Max-Age: 14 日
- パスワード: 環境変数 `IRON_SESSION_PASSWORD`（32 文字以上）

**セッションペイロード:**

```typescript
type NudgeSession = {
  userId: string;          // users.id
  tenantId: string;        // users.tenant_id
  tenantCode: string;      // e.g. "city-tokyo"
  sub: string;             // Keycloak sub claim
  email: string;
  displayName: string;
  refreshToken: string;    // Keycloak refresh_token
  accessTokenExp: number;  // access_token 有効期限 (Unix epoch)
};
```

- `access_token` 自体は Cookie に入れない（サイズ削減）
- 必要な場面で `refresh_token` で取り直す
- v0.2 ではアプリ側で access_token を使う場面はない（KC Admin API 呼び出しは v0.3 で別の client credentials grant を使う）

### 2.6 ユーザープロビジョニング

- **JIT（Just-In-Time）プロビジョニング**: OIDC コールバック時に `users` テーブルへ upsert
- v0.2 時点では、ユーザーは自分が初めてログインしたときに `users` へ登録される
- **v0.2 の既知の制約**: 「入社したての職員（未ログイン）に依頼を送る」というユースケースは v0.2 では満たせない。これは v0.3 の Keycloak Admin API ポーリング同期で対応する
- JIT による `users` 作成時、`user_org_unit` や `user_role` は一切セットしない（所属なしのテナントメンバーとして扱う）
- 組織アサインは v0.3 以降の管理画面で別途行う

**Upsert SQL:**
```sql
INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
VALUES ($1, $2, $3, $4)
ON CONFLICT (tenant_id, keycloak_sub)
DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  updated_at = now()
RETURNING id;
```

KC 側の情報（email, display_name）が毎回のログインで Nudge に反映される。KC がマスター。

### 2.7 ログアウトフロー

**ログアウトの選択肢と採用:**
- **RP-initiated logout（Keycloak の end_session_endpoint を呼ぶ）** を採用する
- 「ローカルログアウト（Nudge の session cookie だけ破棄）」は採用しない（KC SSO セッションが生きているので、次回アクセス時に即座に再ログインされてしまい、UX として意味をなさない）

**UI 要件:**
- ログアウトボタンを常時表示しない
- 画面上部の**ハンバーガーメニュー**または**ユーザーアバター**のみ常時表示
- そのメニューを開くとドロップダウン内にログアウト項目が現れる
- クリックで警告モーダルを表示

**警告モーダルの文言（v0.2 の仕様として固定）:**

> ログアウトすると、Teams や社内ポータルなど SSO 連携中の他のアプリからもログアウトされます。続行しますか？
>
> Nudge だけ非表示にしたい場合は、ブラウザのタブを閉じてください。セッションは 14 日間保持されるので、通知から再アクセスすると自動で復帰します。

- `[キャンセル] [ログアウトする]` の 2 ボタン
- 「ログアウトする」で `POST /t/<code>/logout` → サーバ側で KC `end_session_endpoint` にリダイレクト → KC 完了後 `/t/<code>/logged-out` に戻る

### 2.8 Token リフレッシュ戦略

- セッション Cookie の `accessTokenExp` が切れている、または 60 秒以内に切れる場合、middleware または該当ハンドラで `refresh_token` を使って再取得
- 更新失敗（refresh_token 期限切れ等） → セッション破棄 → `/t/<code>/login` へ
- v0.2 では access_token を使う場面がほぼないので、実運用上のリフレッシュ発火は稀

## 3. OIDC フローの詳細

### 3.1 ログイン開始 (`GET /t/<code>/login`)

```
1. middleware がテナント解決済み (request.tenant 属性)
2. returnTo クエリパラメータを取得（default: /t/<code>/）
3. openid-client.Issuer.discover(tenant.keycloak_issuer_url)
   - Issuer キャッシュ: in-memory Map、TTL 1 時間
4. Client を生成
   - client_id = env.OIDC_CLIENT_ID
   - client_secret = env.OIDC_CLIENT_SECRET
   - redirect_uri = `${env.OIDC_REDIRECT_URI_BASE}/t/<code>/auth/callback`
5. state, code_verifier, nonce を generators.xxx() で生成
6. state cookie に { state, verifier, nonce, returnTo } を保存
   - 別 cookie: `nudge_oidc_state`, httpOnly, Max-Age: 10 分
   - iron-session で暗号化
7. client.authorizationUrl({ state, code_challenge, code_challenge_method: 'S256', nonce, scope: 'openid email profile' })
8. 302 リダイレクト
```

### 3.2 コールバック (`GET /t/<code>/auth/callback`)

```
1. state cookie を読む（無ければ 400）
2. openid-client.callback(redirectUri, query, { state, nonce, code_verifier })
   → tokenSet { id_token, access_token, refresh_token, expires_at }
3. tokenSet.claims() で id_token のクレームを取得
   → { sub, email, name, preferred_username, ... }
4. withTenant(appPool, tenantId, async (client) => {
     const { rows } = await client.query(
       `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, keycloak_sub)
        DO UPDATE SET
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name,
          updated_at = now()
        RETURNING id`,
       [tenantId, sub, email, name || preferred_username]
     );
     return rows[0].id;
   })
5. iron-session で nudge_session cookie を焼く
6. state cookie を破棄
7. redirect to returnTo
```

### 3.3 ログアウト (`POST /t/<code>/logout`)

```
1. セッション読む
2. Keycloak Issuer.discover(...)
3. end_session_url を組立
   - id_token_hint (無ければ省略)
   - post_logout_redirect_uri = `${base}/t/<code>/logged-out`
4. Nudge の session cookie 破棄
5. 302 リダイレクト to end_session_url
6. KC が後始末後に post_logout_redirect_uri に戻す
```

### 3.4 エラーハンドリング

| 状況 | 対応 |
|---|---|
| テナントコードが DB に無い | 404 ページ |
| ログイン中に state cookie 無し/期限切れ | `/login` に再誘導、エラー理由をクエリで表示 |
| コールバックで state/nonce 不一致 | 400 エラーページ + ログ |
| id_token 検証失敗 | 400 エラーページ + ログ |
| JIT upsert 失敗（DB エラー） | 500 エラー + ログ |
| session cookie 復号失敗 | cookie 破棄 → `/login` へ |
| refresh_token 期限切れ | session 破棄 → `/login` へ |

## 4. コンポーネント設計

### 4.1 middleware.ts（Node Runtime）

```typescript
export const config = {
  matcher: [
    // 静的ファイルと _next 以外の全パス
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

export const runtime = 'nodejs'; // Edge は pg が動かない

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // 1. ルートはランディング or 404
  if (path === '/') return NextResponse.next();
  if (path.startsWith('/api/health')) return NextResponse.next();

  // 2. /t/<code>/... 以外は 404
  const m = path.match(/^\/t\/([^/]+)(.*)$/);
  if (!m) return new NextResponse('Not Found', { status: 404 });

  const [, code, rest] = m;
  const tenant = await resolveTenant(code);
  if (!tenant) return new NextResponse('Not Found', { status: 404 });

  // 3. 認証不要パス
  if (rest === '/login' || rest === '/auth/callback' || rest === '/logged-out') {
    return forwardWithTenant(request, tenant);
  }

  // 4. 認証必要パス
  const session = await getSession(request);
  if (!session || session.tenantId !== tenant.id) {
    const loginUrl = new URL(`/t/${code}/login`, request.url);
    loginUrl.searchParams.set('returnTo', path);
    return NextResponse.redirect(loginUrl);
  }

  // 5. token refresh が必要ならここで試みる（失敗時は /login へ）
  // ...

  return forwardWithTenant(request, tenant);
}
```

### 4.2 `src/tenant/resolver.ts`

- LRU キャッシュ（`lru-cache` or 自前の小実装）、最大 100 エントリ、TTL 300 秒
- `getTenantByCode(code: string): Promise<Tenant | null>`
- 内部で `adminPool.query('SELECT ... FROM tenant WHERE code = $1', [code])`
- キャッシュミスでも DB 失敗時は例外を投げない（null を返して 404 にさせる）
- テナント情報のキャッシュ無効化 API はこのスコープでは持たない（admin が手動で再起動）

### 4.3 `src/auth/oidc-client.ts`

- `getOidcClient(tenant: Tenant): Promise<Client>`
- Issuer discovery は Map ベースのキャッシュ、キーは `tenant.id`
- Client オブジェクトは毎回作る（軽量）
- TTL 管理は Issuer レベルで 1 時間

### 4.4 `src/auth/session.ts`

- `getSession(req): Promise<NudgeSession | null>`
- `setSession(res, session): Promise<void>`
- `destroySession(res): Promise<void>`
- iron-session の `getIronSession` を薄くラップ

### 4.5 `src/auth/callback.ts`

- `handleCallback(request, tenant): Promise<Response>`
- state cookie 検証、token 交換、JIT upsert、session 発行、returnTo へリダイレクト

### 4.6 `src/components/UserMenu.tsx`

- Client Component
- ハンバーガー/アバター → ドロップダウン
- ログアウト項目クリックで `LogoutConfirmModal` を開く

### 4.7 `src/components/LogoutConfirmModal.tsx`

- 警告文言（セクション 2.7 の文言）を表示
- 「ログアウトする」で `POST /t/<code>/logout` へ form submit

## 5. ディレクトリ構成

```
app/
  layout.tsx
  page.tsx                         # ランディング or 404
  t/
    [code]/
      layout.tsx                   # テナント共通レイアウト + UserMenu
      page.tsx                     # ダッシュボード placeholder
      login/route.ts               # OIDC 開始 (GET)
      auth/callback/route.ts       # OIDC コールバック (GET)
      logout/route.ts              # ログアウト (POST)
      logged-out/page.tsx          # ログアウト後の表示
  api/
    health/route.ts                # ヘルスチェック

middleware.ts                      # テナント解決 + 認証ガード

src/
  config.ts                        # 環境変数ロード + zod 検証
  db/
    pools.ts                       # adminPool() / appPool()
    with-tenant.ts                 # v0.1 の withTenant
  tenant/
    resolver.ts                    # LRU キャッシュ付き lookup
  auth/
    oidc-client.ts                 # Issuer + Client factory
    session.ts                     # iron-session wrapper
    state-cookie.ts                # 一時 state/verifier/nonce 保存
    callback.ts                    # handleCallback
    logout.ts                      # build end_session_url
  components/
    UserMenu.tsx
    LogoutConfirmModal.tsx

migrations/
  020_nudge_app_login.sql          # nudge_app に LOGIN 付与

tests/
  unit/
    tenant/resolver.test.ts
    auth/session.test.ts
    auth/callback.test.ts          # openid-client をモック
    auth/state-cookie.test.ts
    middleware/guard.test.ts
  integration/
    oidc-flow.test.ts              # 本物の Keycloak testcontainer
  helpers/
    keycloak-container.ts          # KC 起動 + realm/client/user 作成
    # 既存の pg-container.ts は adminPool を使うように小幅更新
```

## 6. 依存関係の追加

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "openid-client": "^5.7.0",
    "iron-session": "^8.0.0",
    "zod": "^3.23.0",
    "jose": "^5.9.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

`pg`, `@testcontainers/postgresql`, `testcontainers`, `vitest`, `tsx`, `typescript` は v0.1 で既に入っている。

## 7. 環境変数

`.env.example` に追記する:

```bash
# v0.1 からの継続（名前を変更）
# 旧: DATABASE_URL → 新: DATABASE_URL_ADMIN
DATABASE_URL_ADMIN=postgresql://postgres:postgres@localhost:5432/nudge_dev

# v0.2 新規
DATABASE_URL_APP=postgresql://nudge_app:CHANGE_ME@localhost:5432/nudge_dev
IRON_SESSION_PASSWORD=CHANGE_ME_TO_32_CHAR_RANDOM_STRING_AT_LEAST
OIDC_CLIENT_ID=nudge-web
OIDC_CLIENT_SECRET=CHANGE_ME
OIDC_REDIRECT_URI_BASE=http://localhost:3000
```

`src/config.ts` が起動時に zod で検証、不足があれば即 throw。

## 8. v0.1 からの変更（既存コードへの影響）

1. **`src/db.ts` → `src/db/with-tenant.ts` + `src/db/pools.ts` に分割**
   - 既存の `withTenant` / `withBypass` / `createPool` はそのまま流用
   - 新設: `adminPool()`, `appPool()` の 2 ファクトリ
   - 既存テストの import パスを機械的に更新
2. **`src/migrate.ts`** は `DATABASE_URL_ADMIN` を読むように変更（現状は `DATABASE_URL` を読んでいる）
3. **`docker-compose.dev.yml`** はコメントだけ更新（ローカル開発では postgres superuser のまま使うので実体変更なし）
4. **`.env.example`** を改名・追加（セクション 7 参照）
5. **`tests/helpers/pg-container.ts`** は adminPool 経由で migration 実行する。加えて、migration 020 適用後に `ALTER ROLE nudge_app PASSWORD 'test_password'` をヘルパー側で実行し、テスト用の appPool 接続を可能にする（migration 自体にパスワードをハードコードしないため）
6. **全 schema テスト** は adminPool 経由で実行する（v0.1 と同じく RLS を超えた構造検証）
7. **全 RLS テスト** は `SET LOCAL ROLE nudge_app` を発行しているが、v0.2 ではそれに加えて「appPool（= 実際の nudge_app LOGIN 接続）経由でも同等のテストが通る」ことを確認する新規テストを 1 本追加

## 9. テスト戦略

### 9.1 ユニットテスト

| ファイル | 検証内容 |
|---|---|
| `tests/unit/tenant/resolver.test.ts` | code → tenant lookup、キャッシュヒット/ミス、未存在 |
| `tests/unit/auth/session.test.ts` | iron-session encode/decode、改竄検出、Max-Age |
| `tests/unit/auth/state-cookie.test.ts` | state/verifier/nonce の保存・取り出し・期限切れ |
| `tests/unit/auth/callback.test.ts` | openid-client をモックして、id_token claims → JIT upsert → session 発行の流れを検証 |
| `tests/unit/middleware/guard.test.ts` | 各 URL パターン（未認証、認証済み、テナント mismatch、認証不要パス）に対する分岐 |

### 9.2 統合テスト（1 本）

`tests/integration/oidc-flow.test.ts`:

```
1. Keycloak testcontainer 起動
2. master realm にログイン、test realm "nudge-t1" 作成
3. test realm に client "nudge-web"（confidential、redirect_uri: http://localhost:XXXXX/t/t1/auth/callback）作成
4. test realm に user "alice@example.com" / pwd "alice" 作成
5. Nudge の tenant テーブルに { code: 't1', keycloak_realm: 'nudge-t1', keycloak_issuer_url: '...' } を INSERT
6. Next.js の Node ランタイムを in-process で起動（またはエンドポイント関数を直接呼ぶ）
7. GET /t/t1/login → redirect to KC login URL
8. KC に対して form post（テストクライアントで）→ callback URL に戻る
9. GET /t/t1/auth/callback?code=...&state=... → session cookie 取得
10. adminPool 経由で users テーブルに alice が upsert されていることを検証
11. session cookie を付けて GET /t/t1/ が 200 を返すことを検証
```

- Keycloak コンテナは vitest の `singleFork: true` のおかげでプロセス全体で 1 回のみ起動
- 起動時間 30〜60 秒。CI では許容範囲
- ローカル開発では `pnpm test:unit` と `pnpm test:integration` を分け、普段はユニットのみ回す

### 9.3 テスト実行戦略の追加

`package.json` に script を追加:

```json
{
  "scripts": {
    "test": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:all": "vitest run",
    "test:schema": "vitest run tests/schema tests/rls",
    "test:watch": "vitest tests/unit"
  }
}
```

CI では `pnpm test:all` を実行。

## 10. セキュリティ上の考慮

1. **`DATABASE_URL_APP` は非 superuser** — `nudge_app` ロール経由でないと RLS が効かない
2. **`IRON_SESSION_PASSWORD` は起動時必須** — 短すぎる/未設定なら config 検証で即 throw
3. **state / verifier / nonce** — OIDC のリプレイ攻撃・CSRF 対策。必ず検証する
4. **redirect URI 検証** — `returnTo` パラメータは同一オリジン・同一テナントのパスのみ許可。外部 URL へのリダイレクトを防ぐ
5. **Cookie Path=/t/<code>/** — テナント間で session cookie が混ざらない
6. **middleware で tenantId mismatch チェック** — 古いセッション cookie を持ったままテナント B のパスにアクセスしても拒否される

## 11. 既知の制約と v0.3 への引き継ぎ

- **未ログインユーザーへの依頼送信**: v0.2 では不可能。v0.3 の Keycloak Admin API ポーリング同期で解決する
- **組織階層**: v0.2 では Nudge 管理画面（まだ存在しない）で手動登録する想定。v0.3 で KC グループからの自動同期をオプション機能として追加検討
- **強制ログアウト**: 暗号化 Cookie セッションなので admin が特定ユーザーを即切断することはできない。必要になったら DB セッションテーブル方式に切替
- **セッション失効**: iron-session の Max-Age は 14 日固定。テナントごとの設定は v0.3 以降

## 12. v0.2 の完了条件

以下を満たせば v0.2 は完了:

- [ ] Next.js App Router がビルド・起動できる
- [ ] migration 020 が適用され、`nudge_app` が LOGIN 可能になる
- [ ] `DATABASE_URL_APP` で実際に PG に接続でき、`appPool()` 経由の `withTenant` が動く
- [ ] `middleware.ts` がテナントを解決し、未存在のテナントには 404 を返す
- [ ] 認証必須パスに未認証でアクセスすると `/login` に redirect される
- [ ] `/login` から Keycloak へのリダイレクトが組み立てられる
- [ ] OIDC コールバックで id_token を検証し、`users` への JIT upsert が完了する
- [ ] セッション cookie が焼かれ、認証必須パスにアクセスできる
- [ ] ハンバーガー/アバター → ドロップダウン → ログアウト項目 → 警告モーダル → KC end_session → `logged-out` ページ の一連のフローが動く
- [ ] ユニットテストがすべて通る
- [ ] Keycloak testcontainer を使った統合テスト 1 本が通る
- [ ] v0.1 の既存テストがすべて通る（リグレッション無し）
- [ ] spec 文書 + 実装プラン文書がリポジトリに入っている
