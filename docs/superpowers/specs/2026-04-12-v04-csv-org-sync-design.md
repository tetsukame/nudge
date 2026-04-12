# Nudge v0.4 CSV Import + 組織階層同期設計

- 作成日: 2026-04-12
- 対象: CsvSyncSource + Keycloak グループ → org_unit 同期
- 前提: [v0.1 DB ERD](2026-04-11-db-erd-design.md), [v0.2 App Foundation](2026-04-11-v02-app-foundation-design.md), [v0.3 User Sync](2026-04-12-v03-user-sync-design.md)

## 1. 目的とスコープ

### 解決する課題

1. **KC を持たない小規模自治体**がユーザーと組織を一括投入する手段がない。人事システムから CSV をエクスポートして Nudge に取り込めるようにする。
2. **KC を持つ自治体**でも、組織階層（`org_unit`）と所属（`user_org_unit`）が Nudge に入っていないため、依頼のスコープ指定が機能しない。KC グループ階層を `org_unit` に同期する。

### v0.4 で実装するもの

- `CsvSyncSource`（ユーザー + 組織 + 所属を 1 CSV で一括インポート）
- `KeycloakSyncSource` への `OrgSyncSource` 実装追加（KC グループ → org_unit）
- `org-reconciler`（組織 upsert + `org_unit_closure` 再構築 + `user_org_unit` 同期）
- CSV アップロード API エンドポイント
- 既存同期 API への `full-with-orgs` モード追加
- `tenant_sync_config` の拡張（user/org ソース分離、prefix 設定）
- `org_unit.external_id` 列追加

### スコープ外

- **v0.5+**: ドメインロジック（依頼作成、ターゲット展開、ステータス遷移）
- **v0.5+**: Local auth モード
- **v0.5+**: SCIM / LDAP SyncSource
- **v0.5+**: 管理画面 UI（組織ツリー表示、ユーザー管理画面）
- KC カスタム属性ベースの組織マッピング（将来の OrgSyncSource 追加で対応可能）

## 2. アーキテクチャ上の決定

### 2.1 ユーザー同期と組織同期のソースを分離

テナントごとにユーザーと組織の同期元を独立して設定できる。

| 設定 | 値 | 意味 |
|---|---|---|
| `user_source_type` | `'keycloak'` / `'csv'` / `'none'` | ユーザーの同期元 |
| `org_source_type` | `'keycloak'` / `'csv'` / `'none'` | 組織の同期元 |

典型パターン:
- 大規模（KC + AD/LDAP あり）: keycloak / keycloak
- 中規模（KC あるが組織は人事 CSV）: keycloak / csv
- 小規模（KC なし）: csv / csv
- 同期未設定: none / none

### 2.2 KC グループ → Nudge へのマッピング: プレフィックス規約

KC のグループは汎用ツリーで、組織・役職・プロジェクト等が混在する。テナント設定でプレフィックスを指定し、**何が org_unit で何が group か**を制御する。

```
tenant_sync_config:
  org_group_prefix    = '/組織'           -- この配下 → org_unit に同期
  team_group_prefix   = '/プロジェクト'    -- この配下 → Nudge group に同期（optional、v0.4 ではスキップ）
  ignore_group_prefixes = ['/役職', '/システム管理']
```

- `/組織/総務本部/総務部/総務課` → `org_unit`（level = prefix からの深さ）
- `/プロジェクト/*` → v0.4 では無視（将来 Nudge `group` にマッピング可能）
- `/役職/*` → 無視

**v0.4 では `org_group_prefix` 配下の org_unit 同期のみ実装。** `team_group_prefix` → Nudge `group` へのマッピングは将来対応。

### 2.3 組織の「マスター」: KC がマスター

同期有効テナントでは KC（or CSV）が組織の唯一の真実。

- KC にある組織 → Nudge に upsert
- KC にない組織 → 所属ユーザーがいれば保持（warning ログ）、いなければ削除
- Nudge 管理画面での org_unit 編集は不可（同期有効テナントの場合）
- Nudge の `group`（アドホック集合）は影響なし — 引き続き Nudge 内で自由管理

`tenant_sync_config.org_source_type = 'none'` のテナントでは、将来の管理画面から手動で org_unit を作成・編集可能。

### 2.4 CSV フォーマット

1 ファイルでユーザー + 組織 + 所属を一括投入。人事システムからのエクスポートに近い形式。

```csv
employee_id,email,display_name,org_path,is_primary
emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true
emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true
emp-002,suzuki@city.lg.jp,鈴木花子,/DX推進プロジェクト,false
```

**必須列:** `employee_id`, `email`, `display_name`, `org_path`
**任意列:** `is_primary` (default: `true`), `status` (default: `active`)

**仕様:**
- 同一 `employee_id` の複数行 = 兼務（`is_primary` で主務指定）
- `org_path` から `org_unit` ツリーを自動生成（パスの深さ = level）
- `org_path` が `org_unit` の `external_id` として使用（CSV ソースの場合）
- `employee_id` は `users.keycloak_sub` に格納される。`keycloak_sub` という列名は KC 由来だが、v0.3 の reconciler が `externalId` → `keycloak_sub` にマッピングする汎用設計になっているため、CSV の employee_id もそのまま格納される。列名のリネームは v0.1 スキーマ互換性のため行わない
- エンコーディング: UTF-8 BOM → UTF-8 → Shift-JIS の順で自動検出
- 区切り: カンマ
- ファイルサイズ上限: 10MB

**バリデーション:**
- `employee_id`: 空でないこと
- `email`: 空でないこと
- `display_name`: 空でないこと
- `org_path`: `/` で始まり、少なくとも 1 階層あること
- エラーは行番号付きで先頭 10 件を返却

### 2.5 `org_unit.external_id` の追加

組織の外部 ID（KC group UUID or CSV org_path）を追跡するための列。

- KC 同期: `external_id` = KC group UUID
- CSV 同期: `external_id` = org_path（例: `/総務本部/総務部/総務課`）
- 手動作成: `external_id` = NULL
- テナント内で UNIQUE（NULL は重複可、部分インデックス）

### 2.6 `org_unit_closure` 再構築戦略

組織構造が変わるたびに closure table をフル再構築。

```sql
DELETE FROM org_unit_closure WHERE tenant_id = $1;

WITH RECURSIVE tree AS (
  SELECT id, id AS ancestor, 0 AS depth
  FROM org_unit WHERE tenant_id = $1
  UNION ALL
  SELECT o.id, t.ancestor, t.depth + 1
  FROM org_unit o JOIN tree t ON o.parent_id = t.id
  WHERE o.tenant_id = $1
)
INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
SELECT $1, ancestor, id, depth FROM tree;
```

- v0.1 で「ランタイムクエリでは再帰 CTE を使わない」方針だが、同期バッチの 1 回限りの再構築では再帰 CTE が最もシンプル
- 数千 org_unit なら <100ms
- ランタイムの検索は引き続き closure table の JOIN（再帰 CTE 不使用）

## 3. OrgSyncSource インターフェース

```typescript
// src/sync/types.ts に追加

export type SyncOrgRecord = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  level: number;
};

export type OrgSyncResult = {
  created: number;
  updated: number;
  removed: number;
  membershipsUpdated: number;
};

export interface OrgSyncSource {
  fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]>;
  fetchOrgMemberships(): AsyncGenerator<{
    orgExternalId: string;
    userExternalId: string;
    isPrimary: boolean;
  }[]>;
}
```

## 4. 実装する SyncSource

### 4.1 KeycloakSyncSource（OrgSyncSource 追加）

既存の `KeycloakSyncSource` クラスに `OrgSyncSource` を実装追加。

**fetchAllOrgs():**
```
GET /admin/realms/{realm}/groups?briefRepresentation=false
→ ツリーを再帰走査
→ org_group_prefix 配下のみ抽出
→ KC group UUID → externalId
→ グループ名 → name
→ 親グループ UUID → parentExternalId
→ prefix からの深さ → level
→ チャンクで yield
```

**fetchOrgMemberships():**
```
抽出した org グループごとに:
  GET /admin/realms/{realm}/groups/{groupId}/members?max=500
  → ページネーション付き
  → メンバーの id (= keycloak_sub = userExternalId) + org UUID + isPrimary=false
  → isPrimary は KC グループだけでは判定不能 → 最初の所属を primary とする（or 全部 false で Nudge 側で設定）
```

**isPrimary の扱い:** KC グループメンバーシップには「主務/兼務」の概念がない。v0.4 では**全メンバーシップを `is_primary = false` で同期し、ユーザーの最初の所属のみ `is_primary = true`** とする。行政の実運用では人事システム側で主務フラグを管理し、KC カスタム属性 or CSV で渡すのが正道。

### 4.2 CsvSyncSource

1 つの CSV ファイルから `SyncSource`（ユーザー）と `OrgSyncSource`（組織 + 所属）の両方を実装。

```typescript
class CsvSyncSource implements SyncSource, OrgSyncSource {
  constructor(csvContent: string)

  // SyncSource (users)
  async *fetchAllUsers(): AsyncGenerator<SyncUserRecord[]>
    → CSV の各行から { externalId: employee_id, email, displayName, active }
    → 同一 employee_id は最初の行のユーザー情報を採用

  // OrgSyncSource (orgs)
  async *fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]>
    → CSV の org_path を重複排除 + ツリー展開
    → /総務本部/総務部 → [
        { externalId: '/総務本部', name: '総務本部', parent: null, level: 0 },
        { externalId: '/総務本部/総務部', name: '総務部', parent: '/総務本部', level: 1 }
      ]

  // OrgSyncSource (memberships)
  async *fetchOrgMemberships(): AsyncGenerator<...>
    → CSV の各行から { orgExternalId: org_path, userExternalId: employee_id, isPrimary }
```

### 4.3 CSV パーサー

```typescript
// src/sync/csv-parser.ts

export type CsvRow = {
  employee_id: string;
  email: string;
  display_name: string;
  org_path: string;
  is_primary: boolean;
  status: 'active' | 'inactive';
  lineNumber: number;
};

export type CsvParseResult =
  | { ok: true; rows: CsvRow[] }
  | { ok: false; errors: { line: number; message: string }[] };

export function parseSyncCsv(content: string): CsvParseResult;
```

- `csv-parse` ライブラリ（sync 版）で解析
- エンコーディング自動検出: UTF-8 BOM → Shift-JIS heuristic → UTF-8 fallback
- バリデーションエラーは先頭 10 件で切る

## 5. org-reconciler

```typescript
// src/sync/org-reconciler.ts

export async function reconcileOrgs(
  adminPool: pg.Pool,
  tenantId: string,
  source: OrgSyncSource,
): Promise<OrgSyncResult>;
```

**処理フロー:**

```
1. source.fetchAllOrgs() で全組織を取得
2. 各 org について:
   - external_id で org_unit を検索
   - 存在しない → INSERT (tenant_id, external_id, name, level, parent_id=後で設定)
   - 存在して name が違う → UPDATE
3. parent_id を設定:
   - parentExternalId → 親の org_unit.id を lookup
   - org_unit.parent_id を UPDATE
4. KC/CSV にないが DB にある org_unit (external_id が Set に無い):
   - user_org_unit で所属ユーザーがいる → 保持、warning ログ
   - いない → DELETE
5. org_unit_closure をフル再構築（再帰 CTE）
6. source.fetchOrgMemberships() で所属を取得
7. 各メンバーシップ:
   - user_org_unit を upsert (userExternalId → users.keycloak_sub, orgExternalId → org_unit.external_id)
8. KC/CSV にない user_org_unit を削除（同期ソースがマスター）
9. is_primary の調整: 各ユーザーで is_primary=true が 0 件なら最初の所属を primary に
```

## 6. API

### 6.1 既存エンドポイントの拡張

```
POST /api/admin/sync/users
Body: { "tenantCode": "city-tokyo", "mode": "full" | "delta" | "full-with-orgs" }

"full-with-orgs":
  1. org_source_type を確認（'keycloak' or 'csv'）
  2. OrgSyncSource を構築
  3. reconcileOrgs() 実行
  4. reconcileUsers() 実行（既存）
  Response に orgs フィールドを追加
```

### 6.2 新規: CSV アップロード

```
POST /api/admin/sync/csv
Content-Type: multipart/form-data
  file: <CSV ファイル>
  tenantCode: "village-abc"

認証: API キー or session tenant_admin

処理:
  1. ファイルサイズチェック（≤ 10MB）
  2. parseSyncCsv() で解析
  3. CsvSyncSource を構築
  4. reconcileOrgs() → org_unit + closure + user_org_unit
  5. reconcileUsers() → users

Response 200:
  {
    "users": { "created": 10, "updated": 2, "deactivated": 0, "reactivated": 0 },
    "orgs": { "created": 5, "updated": 0, "removed": 0, "membershipsUpdated": 12 }
  }

Response 400: { "errors": [{ "line": 3, "message": "missing email" }] }
Response 413: ファイルサイズ超過
```

## 7. データモデル変更

### 7.1 migration 025: `tenant_sync_config` 列変更

```sql
ALTER TABLE tenant_sync_config RENAME COLUMN source_type TO user_source_type;

ALTER TABLE tenant_sync_config ADD COLUMN org_source_type TEXT NOT NULL DEFAULT 'none'
  CHECK (org_source_type IN ('keycloak', 'csv', 'none'));

ALTER TABLE tenant_sync_config DROP CONSTRAINT tenant_sync_config_source_type_check;
ALTER TABLE tenant_sync_config ADD CONSTRAINT tenant_sync_config_user_source_type_check
  CHECK (user_source_type IN ('keycloak', 'csv', 'none'));

ALTER TABLE tenant_sync_config ADD COLUMN org_group_prefix TEXT DEFAULT '/組織';
ALTER TABLE tenant_sync_config ADD COLUMN team_group_prefix TEXT;
ALTER TABLE tenant_sync_config ADD COLUMN ignore_group_prefixes TEXT[];
```

### 7.2 migration 026: `org_unit.external_id`

```sql
ALTER TABLE org_unit ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX org_unit_tenant_external_idx
  ON org_unit (tenant_id, external_id) WHERE external_id IS NOT NULL;
```

## 8. ディレクトリ構成

```
migrations/
  025_sync_config_org_columns.sql
  026_org_unit_external_id.sql

src/sync/
  types.ts                     # OrgSyncSource, SyncOrgRecord, OrgSyncResult 追加
  org-reconciler.ts            # 組織 upsert + closure 再構築 + 所属同期
  keycloak-source.ts           # OrgSyncSource 実装追加
  csv-source.ts                # CsvSyncSource (users + orgs)
  csv-parser.ts                # CSV パース + バリデーション + エンコーディング検出

app/api/admin/sync/
  users/route.ts               # mode='full-with-orgs' 追加
  csv/route.ts                 # CSV アップロードエンドポイント

tests/
  schema/
    org-unit-external-id.test.ts
    sync-config-org.test.ts
  unit/sync/
    org-reconciler.test.ts
    csv-parser.test.ts
    csv-source.test.ts
    keycloak-org-source.test.ts
  integration/
    sync-orgs.test.ts          # KC グループ → org_unit E2E
    csv-import.test.ts         # CSV アップロード E2E
```

## 9. 依存関係の追加

```json
{
  "dependencies": {
    "csv-parse": "^5.5.0"
  }
}
```

`csv-parse` は Node.js 標準的な CSV パーサー。sync 版は `csv-parse/sync` から import。stream 版は大量行でも低メモリ。

## 10. テスト戦略

### 10.1 ユニットテスト

| ファイル | 内容 |
|---|---|
| `csv-parser.test.ts` | UTF-8 / BOM / Shift-JIS 検出、必須列バリデーション、兼務（複数行同一ユーザー）、行番号エラー、10MB 超拒否 |
| `csv-source.test.ts` | CSV → SyncUserRecord[] + SyncOrgRecord[] + membership 変換、org_path からのツリー展開 |
| `org-reconciler.test.ts` | org_unit upsert、closure 再構築検証（祖先⇔子孫ペアの正確性）、所属同期、削除判定、is_primary 自動設定 |
| `keycloak-org-source.test.ts` | KC groups API レスポンスモック、prefix フィルタ、ツリー→フラット変換、メンバー取得 |

### 10.2 統合テスト

| ファイル | 内容 |
|---|---|
| `sync-orgs.test.ts` | 本物の KC にグループ階層作成 → full-with-orgs 同期 → org_unit + closure + user_org_unit 検証 |
| `csv-import.test.ts` | CSV 文字列 → CsvSyncSource → reconcileOrgs + reconcileUsers → DB 検証 |

## 11. エラーハンドリング

| 状況 | 対応 |
|---|---|
| CSV パースエラー（不正行） | 400 レスポンスに行番号 + エラー内容（先頭 10 件） |
| CSV ファイルサイズ > 10MB | 413 で即拒否 |
| KC groups API 失敗 | sync_log に失敗記録、他のテナントは続行 |
| org_unit 削除時に所属ユーザーがいる | 削除せず保持、sync_log に warning |
| closure 再構築の循環参照 | 再帰 CTE が無限ループしないよう depth 上限チェック（100 階層） |
| user_org_unit の FK 違反（org_unit が先に削除された） | 所属同期は組織同期の後に実行するため発生しない |

## 12. 完了条件

- [ ] migration 025-026 適用
- [ ] `tenant_sync_config` に `user_source_type` / `org_source_type` / prefix 列が存在
- [ ] `org_unit.external_id` が存在し部分 UNIQUE インデックスあり
- [ ] `OrgSyncSource` interface + `SyncOrgRecord` 型が定義されている
- [ ] `org-reconciler` が org_unit upsert + closure 再構築 + user_org_unit 同期を実行
- [ ] `KeycloakSyncSource` が `OrgSyncSource` を実装（prefix フィルタ付き）
- [ ] `CsvSyncSource` が `SyncSource` + `OrgSyncSource` を実装
- [ ] CSV パーサーが UTF-8 / BOM / Shift-JIS を自動検出
- [ ] `POST /api/admin/sync/users` に `mode='full-with-orgs'` が追加
- [ ] `POST /api/admin/sync/csv` が CSV アップロード → ユーザー + 組織 + 所属同期
- [ ] closure table が再構築後に正しい祖先⇔子孫ペアを保持
- [ ] KC にない org_unit は所属ユーザーがいれば保持
- [ ] ユニット + 統合テスト全通過、v0.3 テストもリグレッションなし
