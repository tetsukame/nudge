# v0.6 フロントエンド UI 設計仕様

**ステータス**: 承認済み
**作成日**: 2026-04-15
**スコープ**: 依頼管理 UI（一覧・詳細・作成・転送）+ メッセージ機能 + レスポンシブ対応（バックエンド API は v0.5 で実装済み、新規 API 3 本追加）

---

## 1. スコープと基本方針

v0.6 は v0.5 で構築した REST API に対するフロントエンド UI をバックエンド先行で実装する。

**含むもの**:
- 自分宛の依頼一覧（TODO リスト）
- 依頼詳細 + ステータス操作（対応済み / 対応不可）
- 転送画面（ユーザー検索 + 理由入力）
- 依頼作成画面（1 ページ完結、複数ターゲット選択）
- メッセージ機能（ブロードキャスト通知 + 個別 Q&A チャット + 未読マーク）
- ログイン / ログアウト（既存 OIDC フローの UI ラップ）
- レスポンシブ対応（PC: サイドバー、スマホ: ボトムタブ）

**含まないもの**:
- 送信済み依頼一覧 + 進捗サマリ（v0.7）
- 部下の依頼一覧 + 代理完了 UI（v0.7）
- E2E テスト / Playwright（v0.7）
- ダークモード
- 多言語対応（日本語固定）
- 通知の実配信（v0.6+ の通知ワーカー）

---

## 2. 技術スタック

- **UI ライブラリ**: shadcn/ui + Tailwind CSS
  - Radix UI ベースでアクセシビリティ標準対応
  - コンポーネントをプロジェクトにコピーする方式でカスタマイズ自由
- **追加パッケージ**: tailwindcss, postcss, autoprefixer, clsx, @testing-library/react, @testing-library/jest-dom
- **テスト**: vitest + React Testing Library（コンポーネントテスト）+ 統合テスト（新規 API）
- **レスポンシブ**: Tailwind の `md:` prefix でブレークポイント 768px

---

## 3. レイアウトとルーティング

### 3.1 レスポンシブ戦略

**PC（768px 以上）**: 左サイドバー（固定幅 200px）+ メインエリア
**スマホ（768px 未満）**: ボトムタブ + フルスクリーン

### 3.2 サイドバー（PC）

```
📋 Nudge
─────────────
📥 自分宛の依頼
➕ 新規依頼作成
─────────────
テナント: {tenant.name}
{user.displayName}
[ログアウト]
```

### 3.3 ボトムタブ（スマホ）

| アイコン | ラベル | 遷移先 |
|---|---|---|
| 📥 | 受信 | `/t/<code>/requests` |
| 👤 | マイページ | プロフィール / ログアウト |

依頼作成はスマホでは非表示（PC 前提の操作）。

### 3.4 ルーティング

```
app/t/[code]/
  layout.tsx            ← サイドバー / ボトムタブの切替レイアウト
  page.tsx              ← リダイレクト → /requests
  requests/
    page.tsx            ← 自分宛の依頼一覧
    new/
      page.tsx          ← 依頼作成（1ページ完結）
    [id]/
      page.tsx          ← 依頼詳細 + ステータス操作 + メッセージ
      forward/
        page.tsx        ← 転送画面
  login/route.ts        ← 既存（v0.2）
  auth/callback/route.ts ← 既存（v0.2）
  logout/route.ts       ← 既存（v0.2）
```

---

## 4. 自分宛の依頼一覧（TODO リスト）

**`/t/<code>/requests`**

既存 API: `GET /t/<code>/api/assignments?status=pending|done`

### 4.1 表示内容

- ステータスタブ: 「未対応」（pending）/ 「完了」（done）切替
- カード: タイトル、送信者名、ステータスバッジ、締切日、期限切れ表示、未読バッジ（🔵）
- ソート: 締切日昇順（急ぎが上）
- ページネーション: 「もっと見る」ボタン（初期 20 件、追加読み込み）

### 4.2 ステータスバッジ

色・アイコン・ラベルは `src/ui/status-config.ts` に定数マップとして集約し、変更しやすくする。

```ts
export const STATUS_CONFIG: Record<AssignmentStatus, {
  label: string;
  icon: string;
  color: string;        // Tailwind クラス
  bgColor: string;
}> = {
  unopened:    { label: '未開封',   icon: '📩', color: 'text-blue-600',   bgColor: 'bg-blue-50' },
  opened:     { label: '開封済み', icon: '📭', color: 'text-gray-600',   bgColor: 'bg-gray-50' },
  responded:  { label: '対応済み', icon: '✅', color: 'text-green-600',  bgColor: 'bg-green-50' },
  unavailable:{ label: '対応不可', icon: '❌', color: 'text-red-600',    bgColor: 'bg-red-50' },
  forwarded:  { label: '転送済み', icon: '↗️', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  substituted:{ label: '代理完了', icon: '👤', color: 'text-orange-600', bgColor: 'bg-orange-50' },
  exempted:   { label: '免除',    icon: '⏭️', color: 'text-gray-500',   bgColor: 'bg-gray-50' },
};
```

### 4.3 未読マーク

`request_comment` の `MAX(created_at)` と `assignment.last_viewed_at` を比較。新しいコメントがあればカードに 🔵 バッジ。

### 4.4 自動開封

詳細ページ遷移時に `PATCH /api/assignments/:id { action: 'open' }` を呼び出し、unopened → opened に自動遷移。

---

## 5. 依頼詳細 + ステータス操作

**`/t/<code>/requests/[id]`**

既存 API: `GET /t/<code>/api/requests/:id`

### 5.1 表示内容

- ヘッダー: タイトル、種別バッジ、ステータスバッジ
- メタ情報: 送信者名、送信日時、締切日
- 本文: プレーンテキスト表示
- アクションエリア: 現ステータスに応じたボタン群
- メッセージエリア: ブロードキャスト通知 + 個別チャット（セクション 7 参照）

### 5.2 アクションボタン

| 現ステータス | 表示するボタン |
|---|---|
| unopened / opened | 「対応済み」「対応不可」「転送する」 |
| 終端ステータス | ボタンなし（ステータスバッジのみ表示） |

**対応済み**: 確認ダイアログ（メモ入力任意）→ `PATCH { action: 'respond', note? }`
**対応不可**: 理由入力ダイアログ（必須）→ `PATCH { action: 'unavailable', reason }`
**転送**: `/t/<code>/requests/[id]/forward` に遷移

### 5.3 転送画面

**`/t/<code>/requests/[id]/forward`**

- ユーザー検索フィールド（名前・メール部分一致）→ 新規 API `GET /api/users/search?q=...`
- 検索結果リスト（所属組織も表示）
- 理由入力（任意）
- 「転送する」→ 確認ダイアログ → `PATCH { action: 'forward', toUserId, reason }`
- 成功時: 依頼詳細に戻る

---

## 6. 依頼作成画面

**`/t/<code>/requests/new`**

1 ページ完結型。スマホでは非表示（PC 前提の操作）。

### 6.1 フォーム構成

**依頼内容セクション**:
- 種別トグル: タスク / アンケート
- タイトル（必須）
- 本文（任意、textarea）
- 締切日（必須、date picker）

**宛先セクション**:
- 種別タブ: 組織 / 個人 / グループ / 全社

**組織タブ**:
- 左: ツリー表示（可視範囲のみ、テナント最上位は省略して局・本部が並ぶ）
- ツリーは折りたたみ式、クリックで選択（複数可）
- 右: 選択済みパネル（各組織に「配下含む」チェックボックス + ✕ 削除）
- 新規 API: `GET /t/<code>/api/org-tree`

**個人タブ**:
- 名前・メール検索 → 候補リスト → 複数選択可
- 新規 API: `GET /t/<code>/api/users/search?q=...`

**グループタブ**:
- 所属グループ一覧 → 複数選択可

**全社タブ**:
- 確認テキスト + チェックボックス
- `tenant_wide_requester` 未保持なら非表示

**確認バー**（画面下部に固定）:
- 選択数と展開予定人数を常時表示
- 「プレビュー」→ ダイアログで最終確認
- 「依頼を送信」→ `POST /api/requests` → 成功時に一覧へリダイレクト

### 6.2 組織ツリー表示ルール

- テナント名（東京都庁）は表示しない → 最上位は局・本部が並ぶ
- `getVisibleOrgUnitIds` で取得した可視範囲のみ表示
- 全社依頼権限者 (`tenant_wide_requester`) はテナント内全組織が表示される

---

## 7. メッセージ機能

### 7.1 データモデル

**マイグレーション 028**:

```sql
CREATE TABLE request_comment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  request_id      UUID NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  assignment_id   UUID REFERENCES assignment(id),  -- NULL = ブロードキャスト
  author_user_id  UUID NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX request_comment_request_idx
  ON request_comment (request_id, created_at);
CREATE INDEX request_comment_assignment_idx
  ON request_comment (assignment_id, created_at)
  WHERE assignment_id IS NOT NULL;
```

- `assignment_id = NULL` → ブロードキャスト（全体通知）
- `assignment_id = 値` → その assignee との個別スレッド

**マイグレーション 028 追加**: `assignment.last_viewed_at TIMESTAMPTZ` カラム追加（未読判定用）

### 7.2 公開範囲

- **ブロードキャスト**: 全 assignee が閲覧可能
- **個別 Q&A**: 当該 assignee + 依頼者のみ閲覧可能
- **依頼者は全 assignee の個別 Q&A を閲覧可能**（管理目的）

### 7.3 API

**`GET /t/<code>/api/requests/:id/comments`**

レスポンス:
```ts
{
  broadcasts: Array<{ id, authorUserId, authorName, body, createdAt }>;
  myThread: Array<{ id, authorUserId, authorName, body, createdAt }>;
  // 依頼者のみ:
  allThreads?: Record<assignmentId, Array<{ ... }>>;
}
```

**`POST /t/<code>/api/requests/:id/comments`**

リクエスト: `{ body: string; assignmentId?: string }`
- `assignmentId` 省略 = ブロードキャスト（依頼者のみ可能）
- `assignmentId` 指定 = 個別スレッド（assignee または依頼者）

### 7.4 UI（依頼詳細画面の下部）

**assignee 視点**:
- ブロードキャスト通知（背景色付きで「📢 お知らせ」ラベル）
- 自分と依頼者のチャット（時系列、左右振り分け — 自分が右、依頼者が左）
- 入力欄 + 送信ボタン

**依頼者視点**:
- ブロードキャスト投稿フォーム（「📢 全体にお知らせ」ボタン）
- assignee ごとにタブまたはアコーディオンで個別 Q&A を表示
- 各スレッドに返信可能

### 7.5 未読マーク

- `request_comment.MAX(created_at) > assignment.last_viewed_at` → 未読
- 一覧カードに 🔵 バッジ
- 詳細ページ表示時に `last_viewed_at = now()` を UPDATE

---

## 8. 新規 API（3 本）

### 8.1 `GET /t/<code>/api/org-tree`

可視範囲の組織ツリーを返す。`getVisibleOrgUnitIds` で ID 一覧取得 → `org_unit` + `org_unit_closure` から木構造を構築。テナント直下の root は省略し、第 2 階層（局・本部）をトップレベルとして返す。

レスポンス:
```ts
type OrgTreeNode = {
  id: string;
  name: string;
  memberCount: number;
  children: OrgTreeNode[];
};
// Array<OrgTreeNode>（局・本部がフラットに並ぶ）
```

`tenant_wide_requester` / `tenant_admin` はテナント内全組織が返る。

### 8.2 `GET /t/<code>/api/users/search?q=...`

可視範囲内のユーザーを名前・メール部分一致で検索。上限 20 件。

レスポンス:
```ts
{ items: Array<{ id, displayName, email, orgUnitName }> }
```

### 8.3 `GET/POST /t/<code>/api/requests/:id/comments`

セクション 7.3 参照。

---

## 9. 局単位運用の対応

テナントは都全体で 1 つ（Keycloak realm = Entra 連携が 1 つ）。局単位の運用は UI フィルタリングで実現：

- 組織ツリーは可視範囲のみ表示（`getVisibleOrgUnitIds` が自組織配下のみ返す）
- ユーザー検索も可視範囲内に制限
- API 層の権限チェック（v0.5）がセキュリティ境界を担保
- `tenant_wide_requester` は都庁全体への依頼が必要な部署にのみ運用で付与

DB・API の変更なし。UI の表示フィルタのみ。

---

## 10. ファイル構造

```
src/ui/
  status-config.ts          ← ステータス色・アイコン・ラベル定数マップ
  components/
    sidebar.tsx             ← PC サイドバー
    bottom-tabs.tsx         ← スマホ ボトムタブ
    status-badge.tsx        ← ステータスバッジ
    org-tree-picker.tsx     ← 組織ツリー選択（複数可）
    user-search.tsx         ← ユーザー検索
    comment-thread.tsx      ← メッセージスレッド
    confirm-dialog.tsx      ← 確認ダイアログ

app/t/[code]/
  layout.tsx                ← レスポンシブレイアウト
  requests/
    page.tsx                ← 一覧
    new/page.tsx            ← 作成
    [id]/page.tsx           ← 詳細
    [id]/forward/page.tsx   ← 転送
  api/
    org-tree/route.ts       ← 新規
    users/search/route.ts   ← 新規
    requests/[id]/comments/route.ts ← 新規
```

---

## 11. テスト戦略

### 11.1 コンポーネントテスト（vitest + React Testing Library）

- `status-badge.test.tsx` — ステータスに応じた色・アイコン・ラベルの出し分け
- `org-tree-picker.test.tsx` — 展開・選択・複数選択・配下含むチェック
- `comment-thread.test.tsx` — ブロードキャスト表示、個別チャット表示、依頼者 vs assignee の表示分岐
- `confirm-dialog.test.tsx` — ダイアログの表示・確認・キャンセル

### 11.2 API 統合テスト

- `org-tree.test.ts` — 可視範囲フィルタ、テナント最上位省略
- `users-search.test.ts` — 部分一致検索、可視範囲制限
- `comments.test.ts` — ブロードキャスト投稿、個別投稿、公開範囲（assignee vs 依頼者）
- `last-viewed-at.test.ts` — 未読判定のロジック

### 11.3 手動テスト

- dev server (`pnpm dev`) で全画面フローを PC / スマホエミュレーションで確認
- ゴールデンパス: ログイン → 一覧 → 詳細 → 対応済み → 一覧に戻る
- 依頼作成: 複数組織選択 → プレビュー → 送信
- 転送: 詳細 → 転送 → ユーザー選択 → 送信
- メッセージ: 詳細 → コメント投稿 → 一覧で未読バッジ確認
