# v0.5 ドメインロジック 設計仕様（ドラフト）

**ステータス**: ドラフト（ブレインストーミング中に保存、次回セッションでレビュー → writing-plans へ）
**作成日**: 2026-04-14
**スコープ**: 依頼作成・ターゲット展開・assignment 状態機械・転送・代理完了・通知レコード生成（バックエンドのみ、UI は v0.6+）

---

## 1. スコープと基本方針

v0.5 は「ドメイン層 + REST API + テスト」のバックエンド完結。UI は v0.6 以降。

**含むもの**:
- 依頼 CRUD（作成・一覧・詳細）
- ターゲット展開（user / org / role / all の 4 種別）
- assignment 状態機械（8 ステータス、期限切れは遅延判定）
- 転送、代理完了、対応不可、免除
- 通知レコード生成（`notification` テーブルへの INSERT のみ、実配信は v0.6+）

**含まないもの**:
- 実際のメール/Teams/Slack 配信
- UI（Next.js ページ、フォーム）
- スケジューラ / cron
- 期限切れリマインド

---

## 2. アーキテクチャ

```
app/t/[code]/api/
  requests/
    route.ts                 ← POST 作成 / GET 一覧
    [id]/route.ts            ← GET 詳細
  assignments/
    route.ts                 ← GET 一覧（自分の TODO）
    [id]/route.ts            ← PATCH 状態遷移・転送・代理完了

src/domain/
  request/
    create.ts                ← 依頼作成 + ターゲット展開
    expand-targets.ts        ← 種別ごとの assignment 展開
    list.ts                  ← scope フィルタ
    permissions.ts           ← 全社依頼権限チェック、可視範囲
  assignment/
    transitions.ts           ← 状態機械（遷移表）
    actions.ts               ← open/resolve/reject/forward/delegate/exempt
    permissions.ts           ← 代理完了・転送の権限チェック
  notification/
    emit.ts                  ← notification テーブルへの INSERT
```

**レイヤリング**:
- Route Handler は認証 / tenant セット / リクエスト検証のみ
- ドメイン関数は `(pool, ctx, input) => result` 形式で pool と actor context を受け取る純関数ライク
- `withTenant` でトランザクション境界を張り、その中でドメイン関数を呼ぶ

---

## 3. 依頼作成とターゲット展開

### 3.1 API

**`POST /t/<code>/api/requests`** リクエストボディ:

```ts
{
  title: string;
  body: string;
  due_at: string;          // ISO8601
  targets: Array<
    | { type: 'user'; user_id: string }
    | { type: 'org'; org_unit_id: string; include_descendants: boolean }
    | { type: 'role'; role_code: string }
    | { type: 'all' }      // 全社依頼権限者のみ
  >;
}
```

### 3.2 処理フロー (`src/domain/request/create.ts`)

1. `withTenant(appPool, tenantId)` でトランザクション開始
2. 権限チェック:
   - `type: 'all'` が含まれる場合、actor に全社依頼権限があるか
   - それ以外の種別でも、全社依頼権限が無い actor は可視範囲（自組織配下 + 所属グループ）に絞る
3. `request` 行を INSERT → `request_id`
4. `request_target` に指定通り行を INSERT（監査用に原型を保存）
5. `expandTargets(client, request_id, targets)` で assignment を種別ごとに展開:
   - user → 1 行
   - org + descendants → `org_closure` JOIN で配下 `user_org_unit` をすべて展開
   - org のみ → 直接所属の `user_org_unit` のみ
   - role → `user_role` から role_code に該当するユーザー全員
   - all → tenant 内の active ユーザー全員
   - 種別ごとに `INSERT ... SELECT ... ON CONFLICT (request_id, user_id) DO NOTHING` を順に実行
   - 重複除去は ON CONFLICT に任せる
6. `notification` テーブルに各 assignee 宛の「依頼受信」通知を INSERT
7. `audit_log` に「request created, expanded: N」を記録
8. COMMIT

### 3.3 全社依頼権限の意味

全社依頼権限は「可視範囲の制限を外す」権限。`type:'all'` 専用ではなく、任意ターゲット指定の制約解除。

- **権限なし**: user / org / role は可視範囲（自組織配下 or 所属グループ）内のみ、`type:'all'` ❌
- **権限あり**: 任意の user / org / role、および `type:'all'` すべて OK

`src/domain/request/permissions.ts` に `canTargetOutsideScope(actor)` として集約。

### 3.4 エラーケース

- 権限なし → 403
- 組織 / ロール / ユーザーが存在しない → 400（個別に詳細を返す）
- 展開結果が 0 件 → 400「対象者がいません」

### 3.5 レスポンス

```ts
{ id: string; expanded_count: number; breakdown: { user: N, org: N, role: N, all: N } }
```

---

## 4. Assignment 状態機械

### 4.1 状態定義 (`src/domain/assignment/transitions.ts`)

```ts
type Status =
  | 'unopened'      // 未開封
  | 'opened'        // 開封済み
  | 'resolved'      // 対応済み（終端）
  | 'rejected'      // 対応不可（終端）
  | 'forwarded'     // 転送済み（終端・連鎖元）
  | 'delegated'     // 代理完了（終端）
  | 'exempted';     // 免除（終端）
// 期限切れは status ではなく due_at 判定
```

### 4.2 遷移表

| From → To | 実行者 | 備考 |
|---|---|---|
| unopened → opened | assignee | 詳細取得時に自動 |
| unopened / opened → resolved | assignee | note 任意 |
| unopened / opened → rejected | assignee | reason 必須 |
| unopened / opened → forwarded | assignee | 転送先 user_id 必須 |
| unopened / opened → delegated | **依頼者 or 対象者の上長** | reason 必須 |
| unopened / opened → exempted | テナント管理者 | reason 必須 |
| 終端ステータスから → | ❌ 遷移不可 | UI 側の確認ダイアログで誤操作をカバー |

**重要な設計判断**: 終端ステータスからの遷移は不可。誤操作で完了にしてしまった場合は UI の確認ダイアログで防ぐ方針。DB・ドメイン層は irreversible。

### 4.3 データ構造

```ts
const TRANSITIONS: Record<Status, Array<{
  to: Status;
  action: ActionName;
  actor: 'assignee' | 'requester' | 'manager' | 'tenant_admin';
  requiresReason?: boolean;
}>> = { ... };

function canTransition(from: Status, to: Status, actorRole: ActorRole): boolean;
```

純関数、transitions.ts は遷移表と 1 関数のみ。

### 4.4 アクション API (`src/domain/assignment/actions.ts`)

- `openAssignment(pool, ctx, assignmentId)` — 詳細取得時に内部呼び出し
- `resolveAssignment(pool, ctx, assignmentId, { note? })`
- `rejectAssignment(pool, ctx, assignmentId, { reason })`
- `forwardAssignment(pool, ctx, assignmentId, { toUserId, reason? })`
- `delegateAssignment(pool, ctx, assignmentId, { reason })`
- `exemptAssignment(pool, ctx, assignmentId, { reason })`

各アクション:
1. `withTenant` でトランザクション
2. `SELECT ... FOR UPDATE` で assignment ロック
3. actor 権限と現ステータスを `canTransition` で検証
4. UPDATE で status 変更、`action_at` 等を設定
5. サイドエフェクト（転送なら新 assignment、代理完了なら本人通知）
6. `audit_log` 記録
7. COMMIT

### 4.5 REST マッピング

`PATCH /t/<code>/api/assignments/:id` に `{ action, ...params }` を渡す。Route Handler は action 名でディスパッチ。エンドポイントは 1 本。

---

## 5. 転送と代理完了の詳細

### 5.1 転送 (`forwardAssignment`)

```
元 assignment: unopened / opened → forwarded（終端）
              ↓ forwarded_to_assignment_id で連鎖
新 assignment: 作成（status=unopened, user_id=転送先）
```

- 新 assignment は元と同じ `request_id`、`user_id` のみ差し替え
- 元 assignment に `forwarded_to_assignment_id` で連鎖
- 転送先への通知を `notification` に INSERT
- 多段転送は制限なし（監査ログで追える）
- 重複転送防止: 既に同一 request_id に対して転送先ユーザーの assignment があれば 409

### 5.2 代理完了 (`delegateAssignment`)

権限チェック (`src/domain/assignment/permissions.ts`):

```ts
async function canDelegate(client, actor, assignment): Promise<boolean> {
  if (actor.user_id === assignment.request.created_by) return true;
  return await isManagerOf(client, actor.user_id, assignment.user_id);
}
```

**`isManagerOf` の定義**:
- assignee の `user_org_unit` をすべて取り、`org_closure` で親組織を辿る
- actor がそれら親組織のいずれかに所属し、かつ `user_role` で manager 相当のロールを持つなら true

- 代理完了後は status=delegated、`delegated_by`, `delegated_reason` を記録
- 本人への通知（「あなたの依頼が代理完了されました」）を `notification` に INSERT
- 依頼者が実行した場合は依頼者への通知は不要

### 5.3 マイグレーション 027

`assignment` テーブルに以下を追加:

- `forwarded_to_assignment_id UUID NULL REFERENCES assignment(id)`
- `forward_reason TEXT NULL`
- `delegated_by UUID NULL REFERENCES app_user(id)`
- `delegated_reason TEXT NULL`
- `rejected_reason TEXT NULL`
- `resolved_note TEXT NULL`
- `action_at TIMESTAMPTZ NULL`（最後にアクションが実行された時刻、ソート・表示用）

---

## 6. 一覧 API と scope フィルタ

### 6.1 `GET /t/<code>/api/requests?scope=mine|subordinate|all&status=...&page=N`

- `scope=mine`（デフォルト）: `created_by = me` OR `EXISTS(assignment WHERE user_id = me)`
- `scope=subordinate`: 自分が manager ロールを持つ組織の配下ユーザーが assignee の依頼
- `scope=all`: 全社依頼権限者のみ許可、テナント内すべての依頼

### 6.2 `GET /t/<code>/api/assignments?status=pending|done&page=N`

- 自分宛の assignment のみ（`user_id = me`）
- `pending` = unopened + opened、`done` = 終端ステータス全部
- `due_at < now()` かつ pending なら `is_overdue: true` を返す
- デフォルトソート: `due_at ASC, created_at DESC`

### 6.3 `GET /t/<code>/api/requests/:id`

- 依頼の詳細 + 自分宛の assignment（あれば）+ 同じ依頼の他 assignment サマリ（権限ある場合のみ）
- 閲覧権限: 作成者 / assignee / subordinate に assignee がいる manager / 全社依頼権限者

### 6.4 実装方針

- `src/domain/request/list.ts` に `listRequests(pool, ctx, { scope, filters, page })`
- scope ごとに WHERE 句を構築、SELECT は 1 本
- ページネーション: 単純な `LIMIT/OFFSET`、1 ページ 50 件、上限 100 件
- scope=all で権限無し → 403
- scope=subordinate で manager ロール無し → 空配列（エラーにしない）
- レスポンス: `{ items, total, page, pageSize }`

---

## 7. 通知レコード生成

v0.5 は `notification` テーブルへの INSERT のみ。実配信は v0.6+ の通知ワーカーで。

**INSERT タイミング**:
- 依頼作成時 → 各 assignee 宛の「依頼受信」通知
- 転送時 → 転送先への「依頼受信」通知
- 代理完了時（依頼者以外が実行）→ assignee への「代理完了されました」通知

`src/domain/notification/emit.ts` に `emitNotification(client, tenantId, userId, type, payload)` を集約。

---

## 8. テスト戦略

v0.2-v0.4 と同じパターンで、スキーマ / 単体 / 統合の 3 層。

### 8.1 スキーマテスト (`tests/schema/`)

- `assignment-extra-columns.test.ts` — マイグレーション 027 のカラム存在と型
- `request-target.test.ts` — v0.5 で使われ方が変わるので 1 ケース追加

### 8.2 単体テスト (`tests/unit/domain/`)

- `request/expand-targets.test.ts` — 4 種別ごとの展開件数、重複除去、権限制限時の絞り込み
- `request/create.test.ts` — 権限エラー、ターゲット 0 件エラー、正常系（audit_log / notification の存在確認）
- `request/list.test.ts` — scope フィルタ 3 パターン、subordinate の可視範囲
- `assignment/transitions.test.ts` — 遷移表の全エントリ網羅（許可・禁止）
- `assignment/permissions.test.ts` — `canDelegate`（requester / manager / その他）、`isManagerOf` の境界
- `assignment/actions.test.ts` — 各アクションの正常系 + 禁止遷移の 409

### 8.3 統合テスト (`tests/integration/`)

- `request-create-flow.test.ts` — REST 経由で依頼作成 → 展開 → notification の存在確認
- `assignment-status-flow.test.ts` — 未開封→開封→対応済み の REST フロー
- `assignment-forward.test.ts` — 転送 → 新 assignment、元 forwarded
- `assignment-delegate.test.ts` — 依頼者 / 上長 / 権限なしの 3 ケース
- `request-list-scope.test.ts` — scope パラメータごとの件数検証

### 8.4 テストデータ

- `tests/helpers/fixtures/` に「3 階層の組織 + manager ロール持ち + 一般ユーザー複数」のシナリオを追加

### 8.5 テスト環境

- v0.5 は Keycloak 不要、PostgreSQL testcontainer + appPool のみ
- 統合テストは appPool 経由で RLS を確実に効かせる

---

## 9. 未決事項 / 次回確認

- [ ] この draft 全体をユーザーがレビュー
- [ ] 必要なら修正 → 最終版化
- [ ] writing-plans skill で実装計画に遷移
