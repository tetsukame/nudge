# Nudge v0.3 ユーザー同期設計

- 作成日: 2026-04-12
- 対象: Keycloak Admin API ポーリングによるユーザー同期（非ログイン職員の事前プロビジョニング）
- ステータス: ドラフト
- 前提: [v0.1 DB ERD 設計書](2026-04-11-db-erd-design.md), [v0.2 App Foundation 設計書](2026-04-11-v02-app-foundation-design.md)

## 1. 目的とスコープ

### 解決する課題

v0.2 の JIT プロビジョニングでは、ユーザーが Nudge に初めてログインするまで `users` テーブルにレコードが作られない。このため「入社したての職員（未ログイン）に依頼を送る」というコアユースケースが満たせない。特に行政では、人事異動時に数千〜数万人が一斉に組織を移動するため、事前プロビジョニングは必須。

### v0.3 で実装するもの

- Keycloak Admin API ポーリングによるユーザー同期（フル同期 + 差分同期のハイブリッド）
- SyncSource インターフェースの抽象化（将来の CSV / SCIM / LDAP 対応の基盤）
- 同期実行 API エンドポイント + 同期状態確認 API
- `tenant.auth_mode` 列の追加（将来の local auth 対応の基盤）
- `tenant_sync_config` テーブル + `sync_log` テーブル

### スコープ外（後続プラン）

- **v0.4+**: CSV インポート（CsvSyncSource）
- **v0.4+**: 組織階層の同期（Keycloak グループ → `org_unit` + `user_org_unit`）
- **v0.5+**: SCIM 2.0 エンドポイント（ScimSyncSource）
- **v0.5+**: Local auth モード（パスワード認証、KC 不要で Nudge 単品運用）
- **v0.5+**: ドメインロジック（依頼作成、ターゲット展開、ステータス遷移）

## 2. アーキテクチャ上の決定

### 2.1 同期方式: フル + 差分ハイブリッド

30 万人規模（東京都 + 基礎自治体）を想定し、2 種類の同期を使い分ける。

**フル同期（重い、低頻度）:**
- KC Admin API `GET /admin/realms/{realm}/users` を OFFSET ページネーション（max=500/page）で全件取得
- `users` テーブルと `keycloak_sub` で突合し、INSERT / UPDATE / inactive 化
- 実行頻度: 毎晩 1 回（cron）or 管理者が手動実行
- 30 万人で 10-30 分（KC の OFFSET ページネーションがボトルネック）

**差分同期（軽い、高頻度）:**
- KC Admin Events API `GET /admin/realms/{realm}/admin-events` で前回同期以降のユーザー作成/更新/削除イベントを取得
- 各イベントのユーザーID で個別に `GET /admin/realms/{realm}/users/{id}` を取得して upsert
- 実行頻度: 15 分ごと（cron）
- 通常 0-50 件/回、数百ミリ秒で完了
- Admin Events が無効な Realm では差分同期をスキップ（フル同期がバックアップ）

**フル同期が差分同期のバックアップ:** Admin Events の保持期間（KC 設定依存）を超えた場合や、Events が無効な場合でも、フル同期が定期的に走ることで完全な整合性を保証する。

### 2.2 SyncSource 抽象化

同期元がテナントごとに異なりうることを前提に、インターフェースを抽象化する。

```typescript
// src/sync/types.ts

export type SyncUserRecord = {
  externalId: string;     // 同期元での一意 ID（KC なら user.id = keycloak_sub）
  email: string;
  displayName: string;
  active: boolean;
};

export type SyncResult = {
  created: number;
  updated: number;
  deactivated: number;
  reactivated: number;
};

export interface SyncSource {
  fetchAllUsers(): AsyncGenerator<SyncUserRecord[]>;
  fetchDeltaUsers?(since: Date): Promise<SyncUserRecord[]>;
}
```

v0.3 では `KeycloakSyncSource` のみ実装。将来の SyncSource 追加は以下を想定:

| SyncSource | 対応バージョン | 対象 |
|---|---|---|
| `KeycloakSyncSource` | v0.3 | KC Admin API 連携 |
| `CsvSyncSource` | v0.4+ | LDAP/AD を持たない小規模自治体 |
| `ScimSyncSource` | v0.5+ | SCIM 2.0 対応 HR システム |
| `LdapSyncSource` | v0.5+ | KC を介さず LDAP 直接連携 |

### 2.3 Reconciler（共通ロジック）

SyncSource に依存しない共通の upsert / deactivate ロジック。

```
reconcileUsers(pool, tenantId, source, mode):
  if mode === 'full':
    seenIds = Set<string>()
    for chunk of source.fetchAllUsers():
      for user of chunk:
        upsert(user)
        seenIds.add(user.externalId)
      commit chunk
    // KC に存在しない users を inactive 化
    deactivateMissing(tenantId, seenIds)

  if mode === 'delta':
    deltaUsers = source.fetchDeltaUsers(since)
    for user of deltaUsers:
      upsert(user)
    // 「DB にいるが KC にいない」チェックはスキップ（差分では全件把握不可）
```

**upsert ロジック:**
```sql
INSERT INTO users (tenant_id, keycloak_sub, email, display_name, status)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (tenant_id, keycloak_sub)
DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  updated_at = now()
WHERE users.email != EXCLUDED.email
   OR users.display_name != EXCLUDED.display_name
   OR users.status != EXCLUDED.status;
```

WHERE 句により、属性が変わっていないユーザーは UPDATE を発行しない（不要な `updated_at` 更新を防ぐ）。

### 2.4 Keycloak SyncSource 実装

**KC Admin API 認証:** Client Credentials Grant

- テナントごとに KC に `nudge-sync` Confidential Client を作成
- Service Account Roles に `view-users` + `view-events`（差分同期用）を付与
- `client_id` + `client_secret` で token を取得して API を叩く
- token はリクエストごとに取得（有効期限の管理を省略）

**fetchAllUsers():**
```
GET /admin/realms/{realm}/users?first=0&max=500&briefRepresentation=false
→ ページネーションで全件取得
→ user.id → externalId
→ user.email → email
→ (user.firstName + ' ' + user.lastName).trim() → displayName
→ user.enabled → active
→ 500 件ごとに yield
```

**fetchDeltaUsers(since):**
```
GET /admin/realms/{realm}/admin-events
  ?operationTypes=CREATE,UPDATE,DELETE
  &resourceTypes=USER
  &dateFrom={since ISO 8601}
→ イベントから userId を抽出（resourcePath: "users/{id}"）
→ CREATE/UPDATE: GET /admin/realms/{realm}/users/{id} で最新状態取得
→ DELETE: { externalId: id, email: '', displayName: '', active: false }
→ 全件まとめて返す
```

### 2.5 KC Admin API の前提条件（テナント管理者の設定作業）

テナントが Nudge のユーザー同期を有効にするために必要な KC 側の設定:

1. KC Realm に `nudge-sync` Client を作成（Confidential、Service Account Enabled）
2. Service Account Roles に `realm-management > view-users` を付与
3. 差分同期を使う場合: `realm-management > view-events` も付与
4. 差分同期を使う場合: Realm Settings > Events > Admin Events: Save Events = ON、Expiration = 7 日以上推奨
5. Nudge の管理画面（or API）で `tenant_sync_config` に `sync_client_id` / `sync_client_secret` を登録

### 2.6 DB 接続とプール

- 同期処理は `appPool` + `withTenant` 経由で RLS 内で実行（通常リクエストと同じ権限モデル）
- `tenant_sync_config` の読み取りは `adminPool` 経由（テナント解決と同じく RLS 外）
- `sync_log` への書き込みも `adminPool` 経由（同期の成否はテナント管理者 + システム管理者が見る）

### 2.7 `tenant.auth_mode` 列（将来の local auth 基盤）

v0.3 で `auth_mode` 列を追加し、デフォルト `'oidc'` とする。

- `'oidc'`: 現行の Keycloak OIDC 認証（v0.2 で実装済み）
- `'local'`: Nudge 単品パスワード認証（v0.5+ で実装予定）

v0.3 では middleware / login route で `auth_mode` を参照し、`'local'` の場合は「未対応です」を返す。`'oidc'` の場合は現行フローをそのまま通す。

**将来の local auth 設計方針（v0.3 spec に記録のみ、実装は v0.5+）:**
- `users` テーブルに `password_hash` 列を追加（argon2）
- `app/t/[code]/login/page.tsx` にログインフォーム（username + password）
- セッションモデル（`NudgeSession`）は共通、`refreshToken` が空
- SyncSource と同様に AuthSource を抽象化: `OidcAuthSource` / `LocalAuthSource`

### 2.8 sync_client_secret の保管

DB に平文保存。RLS でテナント分離済み。

理由:
- OSS セルフホストで、テナント追加のたびに環境変数追加は運用が破綻する
- DB バックアップの暗号化はインフラ層の責務
- KC の client_secret は漏洩時にロテーション容易
- `tenant_notification_config.config_json` と一貫した方針

## 3. API 設計

### 3.1 同期実行

```
POST /api/admin/sync/users

認証（2 種類、どちらか 1 つ）:
  (1) session cookie（テナント管理者 → 管理画面の「今すぐ同期」ボタン用）
  (2) Authorization: Bearer <SYNC_API_KEY>（cron 用、環境変数で管理）

Request Body:
  {
    "tenantCode": "city-tokyo",  // 省略時 = enabled な全テナント
    "mode": "full" | "delta"     // 省略時 = "delta"
  }

Response 200:
  {
    "results": [
      {
        "tenantCode": "city-tokyo",
        "syncType": "delta",
        "created": 3,
        "updated": 5,
        "deactivated": 1,
        "reactivated": 0,
        "durationMs": 450
      }
    ]
  }

Response 401: 認証失敗
Response 500: { "error": "...", "tenantCode": "city-tokyo" }
```

**認証判定:**
1. `Authorization: Bearer` ヘッダがあれば `SYNC_API_KEY` と比較
2. なければ session cookie を読み、`user_role` に `tenant_admin` があるか確認
3. どちらもなければ 401

**`SYNC_API_KEY` は optional 環境変数:** 未設定なら API キー認証は無効（session 認証のみ）。`src/config.ts` の zod スキーマで `optional()` として追加。

### 3.2 同期状態確認

```
GET /api/admin/sync/status?tenantCode=city-tokyo

認証: 同上

Response 200:
  {
    "tenants": [
      {
        "tenantCode": "city-tokyo",
        "enabled": true,
        "sourceType": "keycloak",
        "lastFullSync": "2026-04-12T03:00:00Z",
        "lastDeltaSync": "2026-04-12T08:15:00Z",
        "lastError": null,
        "recentLogs": [
          {
            "syncType": "delta",
            "status": "success",
            "startedAt": "...",
            "finishedAt": "...",
            "created": 0, "updated": 2,
            "deactivated": 0, "reactivated": 0
          }
        ]
      }
    ]
  }
```

## 4. スケジューリング

外部 cron 方式。docker-compose にサービス追加しない。

```bash
# 差分同期: 15 分ごと
*/15 * * * * curl -sf -X POST http://localhost:3000/api/admin/sync/users \
  -H "Authorization: Bearer $SYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"delta"}'

# フル同期: 毎晩 3:00
0 3 * * * curl -sf -X POST http://localhost:3000/api/admin/sync/users \
  -H "Authorization: Bearer $SYNC_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"full"}'
```

## 5. エラーハンドリング

| 状況 | 対応 |
|---|---|
| KC Admin API に接続不可 | `sync_log` に `status='failed'` + error_message、`tenant_sync_config.last_error` に記録、次回 cron で再試行 |
| KC token 取得失敗（secret 不正） | 同上 |
| ページネーション途中で失敗 | そこまでの upsert はコミット済み（チャンクごとに commit）、`sync_log` は `failed`、次回フル同期でキャッチアップ |
| Admin Events API が無効（403 or エラー応答） | delta 同期をスキップ、`sync_log` に `status='failed'` + 「Admin Events が無効です。Realm Settings > Events > Admin Events を有効にしてください」、フル同期には影響なし |
| 複数テナント処理中に 1 テナント失敗 | 失敗テナントをスキップして次へ、レスポンスに部分結果を返す |
| 同時実行（cron が重複起動） | `sync_log.status = 'running'` のレコードが存在するテナントはスキップ（簡易排他） |

## 6. メモリ管理（30 万人規模対応）

- `fetchAllUsers()` は `AsyncGenerator<SyncUserRecord[]>` で 500 件ずつ yield
- reconciler はチャンクごとに DB に upsert + commit → メモリ上は常に 500 件分のみ
- フル同期の「KC にいないユーザーの inactive 化」: 取得した `externalId` を `Set<string>` に蓄積 → 30 万件の UUID (36 bytes) × 300,000 = ~11 MB（許容範囲）
- 最後に DB の `status='active'` なユーザーと突合 → `Set` に無い → `status='inactive'`（既に `inactive` のユーザーは変更しない）

## 7. データモデル（新規テーブル / マイグレーション）

### 7.1 migration 021: `tenant.auth_mode`

```sql
ALTER TABLE tenant ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'oidc'
  CHECK (auth_mode IN ('oidc', 'local'));
```

### 7.2 migration 022: `tenant_sync_config`

```sql
CREATE TABLE tenant_sync_config (
  tenant_id           UUID PRIMARY KEY REFERENCES tenant(id),
  source_type         TEXT NOT NULL DEFAULT 'keycloak'
    CHECK (source_type IN ('keycloak')),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  sync_client_id      TEXT,
  sync_client_secret  TEXT,
  interval_minutes    INTEGER NOT NULL DEFAULT 60,
  last_full_synced_at   TIMESTAMPTZ,
  last_delta_synced_at  TIMESTAMPTZ,
  last_error          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS ポリシー: `tenant_sync_config` は `tenant_id` を持つので、既存の RLS ループ（migration 018/019）に追加する新マイグレーションで対応。ただし sync API は `adminPool` 経由で読み書きするため、実質 RLS を通らない。安全弁として RLS は有効にしておく。

### 7.3 migration 023: `sync_log`

```sql
CREATE TABLE sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  sync_type         TEXT NOT NULL CHECK (sync_type IN ('full', 'delta')),
  source_type       TEXT NOT NULL DEFAULT 'keycloak',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  created_count     INTEGER NOT NULL DEFAULT 0,
  updated_count     INTEGER NOT NULL DEFAULT 0,
  deactivated_count INTEGER NOT NULL DEFAULT 0,
  reactivated_count INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT
);
CREATE INDEX sync_log_tenant_started_idx ON sync_log (tenant_id, started_at DESC);
```

### 7.4 migration 024: 新テーブルに RLS 追加

```sql
-- tenant_sync_config
ALTER TABLE tenant_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sync_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_sync_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- sync_log
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- nudge_app に権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_sync_config TO nudge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_log TO nudge_app;
```

## 8. ディレクトリ構成（新規 / 変更）

```
migrations/
  021_tenant_auth_mode.sql
  022_tenant_sync_config.sql
  023_sync_log.sql
  024_sync_rls.sql

src/
  sync/
    types.ts                    # SyncSource, SyncUserRecord, SyncResult
    reconciler.ts               # 共通 upsert/deactivate ロジック
    keycloak-source.ts          # KC Admin API 実装
  config.ts                     # SYNC_API_KEY 追加（optional）

app/
  api/admin/sync/
    users/route.ts              # POST: 同期実行
    status/route.ts             # GET: 同期状態確認

tests/
  unit/sync/
    reconciler.test.ts
    keycloak-source.test.ts
    api-auth.test.ts
  integration/
    sync-full.test.ts
    sync-delta.test.ts
  schema/
    tenant-sync-config.test.ts  # 新テーブルの構造テスト
    sync-log.test.ts
  helpers/
    keycloak-container.ts       # ユーザー CRUD ヘルパー追加
```

## 9. 環境変数の追加

`.env.example` に追記:

```bash
# v0.3 追加（optional — 未設定なら API キー認証は無効、session 認証のみ）
SYNC_API_KEY=CHANGE_ME_TO_RANDOM_STRING
```

`src/config.ts` の zod スキーマに `SYNC_API_KEY: z.string().optional()` を追加。

## 10. テスト戦略

### 10.1 ユニットテスト

| ファイル | 内容 |
|---|---|
| `tests/unit/sync/reconciler.test.ts` | SyncSource をモック、INSERT / UPDATE / deactivate / reactivate / 属性変更なしスキップ |
| `tests/unit/sync/keycloak-source.test.ts` | KC Admin API レスポンスをモック、ページネーション、Admin Events パース |
| `tests/unit/sync/api-auth.test.ts` | API キー認証 / session 認証の分岐、未認証 401 |

### 10.2 スキーマテスト

| ファイル | 内容 |
|---|---|
| `tests/schema/tenant-sync-config.test.ts` | テーブル構造、CHECK 制約、FK |
| `tests/schema/sync-log.test.ts` | テーブル構造、CHECK 制約、インデックス |

### 10.3 統合テスト（Keycloak testcontainer）

| ファイル | 内容 |
|---|---|
| `tests/integration/sync-full.test.ts` | KC にユーザー作成 → フル同期 → DB 検証 → KC で削除 → 再同期 → inactive |
| `tests/integration/sync-delta.test.ts` | フル同期後に KC でユーザー追加 → Admin Events 経由で delta → DB に反映 |

v0.2 で作った `tests/helpers/keycloak-container.ts` を拡張: KC Admin API でのユーザー追加/削除/更新ヘルパーを追加。

## 11. 行政向け大規模運用への設計メモ

v0.3 の実装で直接対応する範囲と、将来対応の方針を記録する。

### 11.1 4 月大量異動への対処（将来）

- **ステージング方式**（v0.5+ で検討）: 事前に「4/1 適用予定」のデータを投入し、当日バッチで反映
- **v0.3 での現実的対応**: 4/1 に人事システム → KC に反映後、管理者が「今すぐフル同期」を押す。30 万人で 10-30 分かかるが、1 回で済む

### 11.2 同期元が多様（LDAP/AD 有無）

- SyncSource 抽象化により、テナントごとに異なる同期元を設定可能
- v0.3 は KC のみ。KC がない自治体は v0.4 の CSV インポートまで手動（JIT + 管理画面での個別追加）

### 11.3 AuthSource 抽象化（将来の local auth）

- `tenant.auth_mode` = `'local'` のとき、KC 不要で Nudge 単品運用
- パスワードハッシュは argon2
- SyncSource と同様のプラグイン構造: `OidcAuthSource` / `LocalAuthSource`
- v0.5+ で実装予定

## 12. 完了条件

- [ ] migration 021-024 が適用される
- [ ] `tenant_sync_config` / `sync_log` に RLS が効いている
- [ ] SyncSource interface + KeycloakSyncSource が実装されている
- [ ] reconciler がフル同期・差分同期の両モードで動く
- [ ] `POST /api/admin/sync/users` が API キー認証・session 認証の両方で動く
- [ ] `GET /api/admin/sync/status` が同期状態を返す
- [ ] フル同期: KC から全ユーザー取得 → DB upsert + inactive 化
- [ ] 差分同期: KC Admin Events → 差分 upsert
- [ ] ユニットテスト: reconciler / keycloak-source / api-auth
- [ ] スキーマテスト: 2 新テーブル
- [ ] 統合テスト: Keycloak testcontainer で full + delta の E2E
- [ ] v0.2 の既存テストがすべて通る（リグレッション無し）
- [ ] 30 万人規模でメモリ溢れしない設計（AsyncGenerator + チャンク処理）
- [ ] `tenant.auth_mode` 列が存在し、middleware が参照する（`'local'` は未対応表示）
