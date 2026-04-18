# v0.7 依頼者・上長管理 UI 設計仕様

**ステータス**: 承認済み
**作成日**: 2026-04-18
**スコープ**: 依頼者視点の管理画面（送信した依頼 + 進捗管理）と上長視点の管理画面（部下の依頼 + 代理完了）。通知ワーカーは v0.8 へ。

---

## 1. スコープと基本方針

v0.7 は v0.6 で構築した UI 上に「送信した依頼」と「部下の依頼」という 2 つの管理ビューを追加する。バックエンドは既存 API を拡張（新規 API 1 本、scope 追加 1 件、マイグレーション 1 件）。

**含むもの**:
- 送信した依頼一覧（進捗サマリ付き）
- 部下の依頼一覧（`org_unit_manager` 保持者のみ）
- 依頼詳細画面の依頼者セクション追加（assignee 進捗 + 個別チャット統合）
- assignee 一覧 API（フィルタ: 所属組織、グループ、ステータス、検索、未読）
- 代理完了 UI（詳細画面から、チャットにシステムメッセージ記録）
- サイドバーメニュー拡張

**含まないもの**:
- 通知ワーカー / メール・Teams・Slack 実配信（v0.8）
- 一括代理完了
- 組織ツリー複数選択フィルタ（現状はプルダウン + 配下含む切替）
- CSV エクスポート
- アサイニー別の詳細分析グラフ

---

## 2. アーキテクチャ

**ルーティング**:

```
app/t/[code]/
  sent/
    page.tsx                   ← 【新規】送信した依頼一覧
  subordinates/
    page.tsx                   ← 【新規】部下の依頼一覧（manager ロール限定）
  requests/[id]/
    page.tsx                   ← 【拡張】依頼者セクション追加
  api/
    requests/
      [id]/
        assignees/
          route.ts             ← 【新規】assignee 一覧 API
```

**ナビゲーション**:

PC サイドバー:
- 📥 自分宛の依頼
- ➕ 新規依頼作成
- 📤 送信した依頼（【新規】全員表示）
- 👥 部下の依頼（【新規】`org_unit_manager` 保持者のみ表示）

スマホ（ボトムタブは不変）:
- マイページに「送信した依頼」「部下の依頼（該当ユーザのみ）」リンク追加

---

## 3. マイグレーション 029

```sql
-- v0.7: 依頼者の閲覧時刻を記録（個別スレッド未読判定用）
ALTER TABLE request ADD COLUMN last_viewed_by_requester_at TIMESTAMPTZ;
```

依頼者がその依頼を開いた時刻を記録。assignee が依頼者に送ったコメントの `created_at` と比較して未読判定。

スレッド単位ではなく依頼全体で管理（case 1）。依頼を開いた時点で全スレッド既読扱い。

---

## 4. 送信した依頼 一覧画面

**`/t/<code>/sent`**

### 4.1 API

既存 `GET /t/<code>/api/requests` に `scope=sent` を追加。

条件: `r.created_by_user_id = me`

### 4.2 SQL（listSentRequests）

```sql
SELECT r.id, r.title, r.type, r.status, r.due_at, r.created_at,
  COUNT(a.*)::int AS total,
  COUNT(*) FILTER (WHERE a.status = 'unopened')::int AS unopened,
  COUNT(*) FILTER (WHERE a.status = 'opened')::int AS opened,
  COUNT(*) FILTER (WHERE a.status = 'responded')::int AS responded,
  COUNT(*) FILTER (WHERE a.status = 'unavailable')::int AS unavailable,
  COUNT(*) FILTER (
    WHERE a.status IN ('forwarded','substituted','exempted','expired')
  )::int AS other,
  COUNT(*) FILTER (
    WHERE a.status IN ('unopened','opened')
      AND r.due_at IS NOT NULL AND r.due_at < now()
  )::int AS overdue_count
FROM request r
LEFT JOIN assignment a ON a.request_id = r.id
WHERE r.created_by_user_id = $1
  AND ($2::text IS NULL OR r.title ILIKE $2)
GROUP BY r.id
ORDER BY r.due_at ASC NULLS LAST,
         (COUNT(a.*) - COUNT(*) FILTER (
           WHERE a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')
         )) DESC
LIMIT $3 OFFSET $4
```

### 4.3 UI

各行:
- タイトル、種別バッジ、締切日（期限切れなら赤）
- ステータス別内訳バー: 横並びの小バッジ 5 つ（未開封・開封済み・対応済み・対応不可・その他）
- 進捗: `15/21 完了`
- ⚠️ バッジ: `overdue_count > 0` のとき

**フィルタタブ**:
- 「進行中」= unopened or opened を持つ依頼
- 「完了」= 全 assignee が終端ステータス

**検索**: タイトル部分一致

**並び順**: `due_at ASC NULLS LAST, (total - done) DESC`

---

## 5. 部下の依頼 一覧画面

**`/t/<code>/subordinates`**

### 5.1 アクセス権

`org_unit_manager` テーブルに登録されているユーザーのみアクセス可能。該当しないユーザーは:
- サイドバーからメニュー非表示
- 直接 URL アクセス時は 403

サイドバーの表示判定は `layout.tsx` で `org_unit_manager` の存在クエリを発行し結果をキャッシュ。

### 5.2 API

既存 `GET /t/<code>/api/requests?scope=subordinate` を使用（v0.5 で実装済み）。

集計は「自分の管理配下 assignee のみ」に絞り込み。

### 5.3 SQL（listSubordinateRequests）

```sql
WITH my_subtree_users AS (
  SELECT DISTINCT uou.user_id
  FROM user_org_unit uou
  JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
  JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
  WHERE m.user_id = $1
)
SELECT r.id, r.title, ...,
  COUNT(a.*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS total,
  COUNT(*) FILTER (WHERE a.user_id IN (SELECT ... ) AND a.status = 'unopened')::int AS unopened,
  -- 以下同様、全カウントは配下のみに絞る
FROM request r
LEFT JOIN assignment a ON a.request_id = r.id
WHERE EXISTS (
  SELECT 1 FROM assignment ax
  WHERE ax.request_id = r.id
    AND ax.user_id IN (SELECT user_id FROM my_subtree_users)
)
GROUP BY r.id
ORDER BY r.due_at ASC NULLS LAST, (total - done) DESC
```

### 5.4 UI

送信した依頼と同じレイアウト・操作感。違いは集計対象が「自分の配下 assignee のみ」になる点。

**追加フィルタ**: 自分が manager の組織が複数ある場合、特定の管理対象組織に絞り込めるプルダウン。

---

## 6. 依頼詳細画面の依頼者セクション

**`/t/<code>/requests/[id]` (page.tsx 拡張)**

### 6.1 表示権限

```ts
const canViewRequesterSection =
  req.created_by_user_id === session.userId
  || actor.isTenantAdmin
  || actor.isTenantWideRequester
  || isManagerOfAnyAssignee;
```

`isManagerOfAnyAssignee` は新規クエリで判定:
```sql
SELECT EXISTS(
  SELECT 1 FROM assignment a
  JOIN user_org_unit uou ON uou.user_id = a.user_id
  JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
  JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
  WHERE a.request_id = $1 AND m.user_id = $2
)
```

### 6.2 セクション構成

```
┌─────────────────────────────────────┐
│ 🔒 依頼者のみ閲覧可能                 │ ← 明示ラベル（URL 共有時の配慮）
├─────────────────────────────────────┤
│ 全体進捗                             │
│ ████████░░ 15/21 (71%)              │
│ [未対応: 3] [開封: 5] [対応済み: 10]  │
│                                      │
│ <AssigneeList />                    │ ← セクション 3 の統合版
└─────────────────────────────────────┘
```

### 6.3 管理視点の違い

同じセクション内で視点が切り替わる:

- **依頼者視点** (`created_by_user_id = me`): 全 assignee 表示
- **上長視点** (manager only): 自分の管理配下 assignee のみ表示
- **両方該当** (依頼を作成したかつ部下に送った): 依頼者視点が優先（全員表示）
- **tenant_admin / tenant_wide_requester**: 全 assignee 表示

### 6.4 既読管理

詳細ページを依頼者が開いた時、`request.last_viewed_by_requester_at = now()` を更新。

各スレッドの未読判定: そのスレッドの最新コメント（自分以外が author）の `created_at > last_viewed_by_requester_at` なら未読。

---

## 7. assignee 一覧モジュール（新規 API + UI コンポーネント）

### 7.1 API: `GET /t/<code>/api/requests/:id/assignees`

**クエリパラメータ**:
- `q`: 名前・メール部分一致
- `orgUnitId`: 組織 ID
- `includeDescendants`: 配下含む（デフォルト false）
- `groupId`: グループ ID（`orgUnitId` と排他）
- `status`: カンマ区切りで複数ステータス（例: `unopened,opened`）
- `hasUnread`: 未読スレッドあり（true/false）
- `page`, `pageSize`: デフォルト 50

**レスポンス**:
```ts
{
  items: Array<{
    assignmentId: string;
    userId: string;
    displayName: string;
    email: string;
    orgUnitName: string | null;
    status: AssignmentStatus;
    isOverdue: boolean;
    openedAt: string | null;
    respondedAt: string | null;
    actionAt: string | null;
    forwardedToName: string | null;
    commentCount: number;
    hasUnread: boolean;  // 依頼者視点の未読
  }>;
  total: number;
  page: number;
  pageSize: number;
  summary: {
    unopened: number; opened: number; responded: number;
    unavailable: number; forwarded: number; substituted: number;
    exempted: number; expired: number; overdue: number;
  };
}
```

### 7.2 権限チェック

- 依頼者 / tenant_admin / tenant_wide_requester: 全 assignee
- `org_unit_manager`: 自分の管理配下 assignee のみ
- それ以外: 403

スコープは API 内部で自動判定（actor のロール + 依頼者かどうかを見て WHERE 句を組む）。

### 7.3 UI: `<AssigneeList />`

```
[所属▼] [配下含む☐] [ステータス▼] [☑未読のみ] [🔍 検索...]

フィルタ結果サマリ: 未対応 3, 対応済み 10

┌ 田中太郎 | 人事課 | ✅ 対応済み │
│  💬 2件  [🔵 未読]             │
└─ クリックで展開 ─────────────────┘
  ↓
  ┌─ スレッド表示 ──────────────┐
  │ 田中: 質問があります           │
  │ あなた: ご確認ください         │
  │ [返信入力欄] [送信]           │
  │ [👤 代理完了（上長のみ）]     │
  └──────────────────────────────┘

┌ 鈴木花子 | 総務部 | 📩 未開封  │
│  💬 0件                        │
└─────────────────────────────────┘
```

**PC**: テーブル形式 + インライン展開
**スマホ**: カードリスト + クリックで別画面遷移（`/t/<code>/requests/[id]/assignees/[assignmentId]`）

### 7.4 コンポーネント依存

- 既存の `<CommentThread />` を各行の展開エリアで再利用（`assignmentId` を渡す）
- 既存の `<StatusBadge />` を各行で使用
- フィルタ UI は新規作成（既存の `target-picker.tsx` に近いが別物）

---

## 8. 代理完了 UI（上長向け）

### 8.1 配置

`AssigneeList` の展開行内、チャット履歴の下。上長ビューでかつ assignee が非終端ステータス（unopened/opened）の時のみ「👤 代理完了」ボタンを表示。

### 8.2 操作フロー

1. 部下の依頼一覧 or 依頼詳細で assignee 行を展開
2. 「👤 代理完了」ボタンクリック
3. ダイアログ「代理完了の理由を入力してください（必須）」
4. 理由入力 → 確認ダイアログ「○○さんの依頼を代理完了にします。よろしいですか？」
5. 既存 API `PATCH /t/<code>/api/assignments/:id { action: 'substitute', reason }`
6. 成功時:
   - 該当行のステータスが「代理完了」に更新
   - チャットスレッドに「◯◯上長が代理完了しました。\n理由: ...」のシステムメッセージが自動追加

### 8.3 バックエンド変更

`src/domain/assignment/actions.ts` の `substituteAssignment` 内に、v0.6 の転送時と同パターンでシステムメッセージを `request_comment` に INSERT する処理を追加。

```ts
if (actor.userId !== asg.user_id) {
  const msg = `${actorName} さんが代理完了にしました。\n理由: ${input.reason}`;
  await client.query(
    `INSERT INTO request_comment
       (tenant_id, request_id, assignment_id, author_user_id, body)
     VALUES ($1, $2, $3, $4, $5)`,
    [actor.tenantId, asg.request_id, asg.id, actor.userId, msg],
  );
}
```

権限チェックは既存の `canSubstitute`（依頼者 or 上長）をそのまま使用。

---

## 9. ファイル構造

**新規**:
- `migrations/029_last_viewed_by_requester.sql`
- `src/domain/request/list-sent.ts`
- `src/domain/request/assignees.ts` — assignee 一覧集計 + フィルタ
- `app/t/[code]/api/requests/[id]/assignees/route.ts`
- `app/t/[code]/sent/page.tsx`
- `app/t/[code]/subordinates/page.tsx`
- `src/ui/components/assignee-list.tsx` — フィルタ + 展開 + チャット統合
- `src/ui/components/assignee-list-filters.tsx` — フィルタ UI
- `src/ui/components/progress-bar.tsx` — ステータス別内訳バー
- `src/ui/components/requester-section.tsx` — 詳細画面の依頼者セクション
- `src/ui/components/access-banner.tsx` — 「🔒 依頼者のみ閲覧可能」バナー

**変更**:
- `app/t/[code]/layout.tsx` — サイドバーに manager ロール判定付きメニュー追加
- `app/t/[code]/requests/[id]/page.tsx` — 依頼者セクション統合、`last_viewed_by_requester_at` 更新処理追加
- `src/domain/request/list.ts` — `scope=sent` 追加
- `src/domain/assignment/actions.ts` — substitute 時のシステムメッセージ追加

---

## 10. テスト戦略

### 10.1 ユニット / スキーマテスト

- `tests/schema/request-last-viewed-by-requester.test.ts` — migration 029 のカラム存在確認
- `tests/unit/domain/request/list-sent.test.ts` — scope=sent のフィルタ、サマリ集計、並び順
- `tests/unit/domain/request/assignees.test.ts` — 権限（依頼者 / 上長 / その他）、各フィルタ、ページング、サマリ
- `tests/unit/domain/assignment/actions.test.ts` — 既存に「substitute でチャットにシステムメッセージ」テストを追加

### 10.2 統合テスト

- `tests/integration/sent-requests.test.ts` — REST 経由で送信した依頼一覧取得、集計値の正確性
- `tests/integration/subordinates.test.ts` — 上長ロールで配下の依頼が見える、非上長で空になる
- `tests/integration/assignees-api.test.ts` — 依頼者 / 上長 / 第三者の権限差、フィルタ組合せ
- `tests/integration/substitute-chat.test.ts` — 代理完了実行後に assignee のチャットにシステムメッセージが残る

### 10.3 コンポーネントテスト

- `tests/unit/ui/progress-bar.test.tsx` — ステータス別セグメント表示
- `tests/unit/ui/assignee-list.test.tsx` — 展開/折りたたみ、フィルタ操作、未読バッジ表示

### 10.4 手動テスト

- 送信済み一覧で並び順（締切昇順 → 未完了多い順）
- 上長ビューで自分の配下のみ見える
- 代理完了後、assignee 本人の画面でシステムメッセージが見える
- URL 共有テスト: 依頼者 URL を別ユーザーに送って、依頼者セクションが見えないこと
