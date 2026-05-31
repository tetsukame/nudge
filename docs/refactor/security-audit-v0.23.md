# セキュリティ棚卸し (v0.23)

作成日: 2026-05-31
対象コミット: main @ e45a72d (v0.23 release)

## 目的

v0.23 で短期間に多数の機能を載せた現状に対し、セキュリティ観点で 10 項目 + 追加発見を棚卸し。深刻度 H/M/L で分類し、H 級は本棚卸しと並行して個別 PR で即修正、M 級は v0.24 のリファクタバッチで対応、L 級は要観察として記録する。

## 方法論

- 各観点で grep / 該当ファイル精読 / 既存 audit log や暗号化パターンとの突き合わせ
- 「現コードの動作を読んだ」結果のみを記載。動的解析や fuzz は範囲外
- 推奨対応は **最小修正** を優先（追加機能やフラグの新設は避ける）

## サマリ

| # | 項目 | 深刻度 | 推奨対応 | 状態 |
|---|---|---|---|---|
| S1 | tenant 管理者が任意 URL を設定でき内部宛 SSRF が可能 | **H** | private/loopback/link-local IP の egress 拒否を共通バリデータ化 | 即修正 (別 PR) |
| S2 | adminPool / withTenant バイパス経路 | L | 現状の admin/sync/* は意図的 + auth で保護済み | 観察 |
| S3 | IDOR (body 由来 tenantId/userId) | L | 全 route が session 由来。問題なし | 観察 |
| S4 | 暗号化シークレットが API レスポンスに漏出 | L | view 型は `hasX` boolean。call 型はサーバ内利用のみ | 観察 |
| S5 | 入力長バリデーション欠落 | M | createRequest / 他に title/body 上限がない。template と揃える | v0.24 バッチ |
| S6 | Markdown XSS | L | `rehype-sanitize` 適用済み、`dangerouslySetInnerHTML` 使用ゼロ | 観察 |
| S7 | CSRF | L | `SameSite=Lax` + cookie 単独認証で十分。Origin/Referer 厳格化は将来 | 観察 |
| S8 | API rate limit (AI 整形) | M | `/requests/format` に per-user/min 制限なし。AI 課金にも影響 | v0.24 バッチ |
| S9 | audit log 網羅性 | M | `tenant_ai_config` upsert が監査されていない | v0.24 バッチ |
| S10 | 依存パッケージ脆弱性 | **H** | `next@15.5.15` に high 7 件。`15.5.16+` で全て解消 | 即修正 (別 PR) |
| X1 | `tenant_sync_config.sync_client_secret` が平文保存 | **H** | 既存 `encryptSecret` を流用して列を encrypted 化 | 即修正 (別 PR) |

## H 級（即修正対象）

### S1: SSRF — テナント管理者が設定する URL が内部宛を遮断していない

#### 観測

- [src/domain/ai/config.ts:112-118](../../src/domain/ai/config.ts#L112-L118)
  ```ts
  try {
    const u = new URL(input.endpoint);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('non-http(s)');
    }
  } catch { throw new AIConfigError('endpoint must be a valid http(s) URL', 'validation'); }
  ```
  プロトコルしか見ていない。`http://192.168.1.105:8080/...` や `http://localhost:9000/` を保存できる
- 同様に [migrations/032_tenant_webhook_urls.sql](../../migrations/032_tenant_webhook_urls.sql) で保存する `teams_webhook_url` / `slack_webhook_url`、および `tenant_settings.smtp_host` も検証なし
- 後段ではこれらの URL に対し、ワーカー / API ルート / format テスト送信などから http(s) リクエストが飛ぶ ([src/domain/ai/dify.ts:28](../../src/domain/ai/dify.ts#L28), [src/notification/channel-*](../../src/notification/))

#### 影響

OSS 自社デプロイでは tenant_admin = 内部信頼ユーザのため低リスク。しかしマルチテナント SaaS 提供を視野に入れると、**1 テナントの管理者** が別テナントや管理ネットワーク（KC, PG, メトリクスエンドポイント）に内部 RFC1918 アドレスで egress させてレスポンスを引き出せる。クラウドメタデータ (`169.254.169.254`) も同様。

#### 推奨対応

1. `src/lib/safe-url.ts` に共通バリデータ `assertSafeHttpUrl(url)` を新設:
   - http / https のみ
   - host を DNS 解決した結果 IP が以下に該当する場合は拒否:
     - loopback (`127.0.0.0/8`, `::1`)
     - private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`)
     - link-local (`169.254.0.0/16`, `fe80::/10`)
     - cloud metadata (`169.254.169.254`)
   - allowlist 環境変数 `SAFE_URL_HOST_ALLOWLIST` で例外も許可（OSS self-host で `host.docker.internal` 等）
2. AI config / webhook / SMTP host 保存時にこのバリデータを通す
3. 既に保存済みのレコードへの後方互換: 起動時に warn ログ、UI 上で「⚠️ 内部 IP は v0.24 以降サポート外」表示

#### 注意

DNS rebinding 攻撃も想定し、**バリデーション時の DNS 結果と実通信時の結果が一致するか** まで対策するには HTTP クライアント側で IP 固定が必要。今回はバリデーション層のみ対応し、rebinding は別チケットで扱う。

### S10: 依存脆弱性 — next@15.5.15 に high 7 件

#### 観測

```
14 vulnerabilities found
Severity: 2 low | 5 moderate | 7 high
```

high 7 件はすべて `next` で、修正版 `15.5.16` で全解消:
- Middleware/Proxy bypass (App Router, Pages, 複数経路)
- DoS (Server Actions, image, connection)
- SSRF (server-side)

#### 推奨対応

`pnpm update next@latest` で 15.5.16 以降に上げ、`pnpm audit --prod` がクリーンになることを確認して即マージ。

### X1: `tenant_sync_config.sync_client_secret` が平文保存

#### 観測

[migrations/022_tenant_sync_config.sql:7](../../migrations/022_tenant_sync_config.sql#L7):
```sql
sync_client_secret  TEXT,
```
列名に `_encrypted` がなく、`encryptSecret` / `decryptSecret` を通っていない。adminPool から平文で読み取り、Keycloak への OIDC client_credentials 認証に使われる。

#### 影響

- PG 直接アクセス権を持つ運用者 / 侵入者 が KC 管理 client の secret を取得可能 → KC 上の任意の操作実行
- 既存の SMTP password / webhook URL は暗号化されているのに、KC client secret だけ平文なのは設計の不整合

#### 推奨対応

1. migration 054: 新列 `sync_client_secret_encrypted TEXT` を追加
2. 既存値があれば migration 内で `pgp_sym_encrypt` か、起動時の one-shot 移行スクリプトで暗号化（IRON_SESSION_PASSWORD 由来キーが Node 側にしかないため、後者推奨）
3. `sync_client_secret` 列を **後続 migration で DROP**（後方互換のため 2 PR に分ける）
4. `app/api/admin/sync/*/route.ts` の読み出しを decrypt 経由に
5. Notion へ運用手順（ローテーション手順、暗号化キー喪失時の再設定）を追記

## M 級（v0.24 リファクタバッチで対応）

### S5: 入力長バリデーション欠落

- [src/domain/request/create.ts:59](../../src/domain/request/create.ts#L59) は `title.trim()` のみで length 上限がない
- [src/domain/template/template.ts:43-48](../../src/domain/template/template.ts#L43-L48) は `MAX_TITLE` / `MAX_BODY` を持つ → これと揃える
- ついでに `cancel_reason` / `default_user_prompt` / `system_prompt` 等の自由入力列も上限を定義

推奨: `src/domain/_validation.ts` に共通 `assertTextLength(value, name, max)` を切り出し、各 domain helper の冒頭で検証。

### S8: AI format API のレート制限

- [app/t/[code]/api/requests/format/route.ts](../../app/t/%5Bcode%5D/api/requests/format/route.ts) は memo 長さチェックのみ
- 1 actor がループで叩くと AI プロバイダの課金や遅延を引き起こせる
- 既存の remind が `last_manual_remind_at` で per-record cooldown を持っているのと同じ発想で、**actor 単位の最終呼び出し時刻** を redis 抜きでも PG に持てる
- 推奨: per-actor 30s cooldown + per-tenant 1min N 回上限。IP ベースは Next.js middleware で別途

### S9: audit log 網羅性

監査対象として追加すべきイベント（現状未記録）:
- `tenant_ai_config` upsert (`settings.ai.updated`) — API キー差し替えはセキュリティ関連
- `tenant_ai_config` enabled 切替 (同じイベントで OK)
- `tenant_notification_config` channel enable/disable
- ログイン成功/失敗（KC 側で記録される想定だが NudgeFlow 側にもあると追跡が楽）

推奨: `src/domain/audit-log/emit.ts` ヘルパー (action / target / payload を統一スキーマで insert する thin wrapper) を新設し、現在 18 箇所にある生 INSERT を順次置き換え（拡張性観点とも重なる）。

## L 級（観察記録）

### S2: RLS バイパス経路

[app/api/admin/sync/{users,status,csv}/route.ts](../../app/api/admin/sync/) は `adminPool` を使い withTenant を経由しない。これはクロステナント sync の性質上意図的で、認証は `verifySyncAuth` (`SYNC_API_KEY` Bearer か platform_admin ロール) で保護されている。問題なし。

### S3: IDOR

API route 全て grep した結果、`tenantId` / `userId` を body から取って SQL に渡している箇所はゼロ。`requireSession` が session.tenantId と URL の `:code` の一致を強制 ([app/t/[code]/api/_lib/session-guard.ts:26-28](../../app/t/%5Bcode%5D/api/_lib/session-guard.ts#L26-L28))。

### S4: 暗号化シークレットの漏出

- `getNotificationSettings` / `getAIConfigView` ともに `hasPassword` / `hasApiKey` の boolean のみ返却
- `getAIConfigForCall` は decrypt 済み値を返すが、route ハンドラ内でのみ呼ばれ、`{title, body}` のみフロントへ返す
- エラーメッセージで `error.message` をそのまま返す箇所が複数あるが、現状 provider error には secret は含まれない

### S6: Markdown XSS

[src/ui/components/markdown-renderer.tsx:13-15](../../src/ui/components/markdown-renderer.tsx#L13-L15) で `rehype-sanitize` を適用。リンクは `target="_blank" rel="noopener noreferrer"` 強制。`dangerouslySetInnerHTML` の使用箇所ゼロ。

### S7: CSRF

- session cookie は `httpOnly + SameSite=Lax + Path=/` ([app/t/[code]/auth/callback/route.ts:103](../../app/t/%5Bcode%5D/auth/callback/route.ts#L103))
- POST/PUT/PATCH/DELETE は cookie 認証必須、SameSite=Lax により form 系 CSRF はブロック
- フォーム以外の cross-site fetch には preflight が必要なため CORS で実質防御
- 弱点: PUT/DELETE をフォーム経由で扱えるブラウザ拡張等は理論上ありうるが、現実的脅威は低い
- 将来: `Origin` ヘッダ厳格化 middleware を追加すれば bullet-proof

## 監査の限界

本棚卸しは静的レビューのみ。以下は別枠で扱う:
- 動的 fuzz / ZAP / Burp 等のツールによる API 探索
- 業務ロジックレベルの権限抜け（例: manager が「直接配下でない部下」の依頼を見られるか等）
- PG / KC / OS レベルの設定（pg_hba, ulimit, network policy）
- 運用面（バックアップ暗号化、シークレットローテ手順）

## 次アクション

1. **NDG-83 (S10)**: next を 15.5.16+ に bump → 単独 PR、最優先
2. **NDG-84 (S1)**: 共通 `assertSafeHttpUrl` 実装 + AI config / webhook / SMTP に適用 → 単独 PR
3. **NDG-85 (X1)**: `sync_client_secret` 暗号化 → migration 054 + コード変更（PR は加列のみ。drop は 1 リリース後）
4. **NDG-86 (M 級バッチ)**: S5 + S8 + S9 を 1 つの v0.24 batch PR にまとめる → A2/A3 棚卸し完了後に着手
