# 拡張性棚卸し (v0.23)

作成日: 2026-05-31
対象コミット: main @ 99fa32a (NDG-84 マージ後)

## 目的

v0.23 で短期間に多数の機能を載せた現状に対し、「**今後の拡張で同じパターンを増やすときに痛みなく追従できるか**」の観点で 7 項目を棚卸し。深刻度 H/M/L で分類。

A1 セキュリティが「侵入経路を塞ぐ」目線だったのに対し、A2 拡張性は「**v0.24 以降で同様の機能を追加するとき、コピペで増やせるか・1 箇所修正で済むか**」の目線。

## サマリ

| # | 項目 | 深刻度 | 推奨対応 | 状態 |
|---|---|---|---|---|
| E1 | マジック文字列（ロール / audit action / kind / status）が散在 | M | const + リテラル型ユニオン化 + ENUM テーブルへの集約 | v0.24 バッチ |
| E2 | `list-sent.ts` の SQL builder が `clause === ''` で WHERE/AND を判定する fragile 構造 | **H** | 軽量 `WhereBuilder` を `src/db/where-builder.ts` に切り出し置換 | v0.24 で着手 |
| E3 | `AIProvider` と `Channel` の抽象パターンが似ているが命名・命令が揃っていない | L | 既に派生先抽象は十分機能している。命名統一は機械的に可能 | 観察 |
| E4 | マイグレーションの前方互換 | L | 既存マイグレーションは概ね適切（NOT NULL に DEFAULT 付与、CHECK 変更時の DROP/ADD パターン徹底） | 観察 |
| E5 | API レスポンス形状（`{ok:true}` / `{error}` / `{error, code}` / `{items}` / `{...result}` のばらつき） | M | `mapDomainError(err) → NextResponse` ヘルパー + ok / error shape を 2 種類に集約 | v0.24 バッチ |
| E6 | クライアント Dialog + busy/error/success state の重複パターン（5 箇所） | M | `useAsyncAction` フック + `<ConfirmDialog>` プリミティブ | v0.24 バッチ |
| E7 | API route 内で SQL を直書きしている重い箇所 | M | domain helper に抽出 (大物は [`app/t/[code]/api/requests/[id]/route.ts`](../../app/t/%5Bcode%5D/api/requests/%5Bid%5D/route.ts) GET の ~70 行) | v0.24 バッチ |

H 級 1 件、M 級 4 件、L 級 2 件。**A1 と同様に H 級は単独 PR で先行修正**、M 級は v0.24 リファクタバッチで一括対応。

## H 級（先行修正対象）

### E2: `list-sent.ts` SQL builder の脆弱な分岐

#### 観測

[src/domain/request/list-sent.ts:80-112](../../src/domain/request/list-sent.ts#L80-L112) で動的 WHERE/AND clause を組み立てる際、各 clause が「先頭か否か」を判定するために `creatorClause === ''` / `qClause === ''` を組み合わせて kw を決めている:

```ts
let qClause = '';
if (input.q && input.q.trim()) {
  params.push(`%${input.q.trim()}%`);
  qClause = `${creatorClause === '' ? 'WHERE' : 'AND'} r.title ILIKE $${params.length}`;
}
let retiredClause = '';
if (tenantWide && input.retiredRequesterOnly) {
  const kw = creatorClause === '' && qClause === '' ? 'WHERE' : 'AND';
  retiredClause = `${kw} cu.status = 'inactive'`;
}
// NDG-70: scheduled も同じパターンで追加
let scheduledClause = '';
if (filter === 'scheduled') {
  const kw = creatorClause === '' && qClause === '' && retiredClause === ''
    ? 'WHERE' : 'AND';
  scheduledClause = `${kw} r.status = 'draft' AND r.scheduled_at IS NOT NULL`;
} else {
  const kw = creatorClause === '' && qClause === '' && retiredClause === ''
    ? 'WHERE' : 'AND';
  scheduledClause = `${kw} r.status <> 'draft'`;
}
```

新しい絞り込み (例: NDG-70 scheduled / NDG-80 count) を追加するたびに、すべての前段 clause を列挙する `kw` 判定をコピーして書く必要がある。**実際に NDG-81 (count が draft を除外しなかった merge race) はこのパターンが要因**で、独立ブランチで開発した両 PR がそれぞれ自分の clause を追加した結果、count 側が draft 除外を忘れた。

#### 影響

- 機能追加のたびに条件分岐が深くなり、片方を更新したらもう片方の SQL も合わせて触る必要がある（リスト用 / カウント用の双子コードがある）
- **正解 SQL の根拠が分散**しているため、レビューでも見落としやすい
- 同パターンの拡張先候補: NDG-63 通知スケジューラ（送信元組織絞り込み）、将来の status 種別追加（差戻し中など）

#### 推奨対応

`src/db/where-builder.ts` に軽量ビルダを追加:

```ts
export class WhereBuilder {
  private clauses: string[] = [];
  private params: unknown[] = [];

  add(condition: string, ...values: unknown[]): this {
    // $1, $2 のプレースホルダを params の長さに合わせて自動採番
    this.clauses.push(condition.replace(/\$(\d+)/g, (_, n) =>
      `$${this.params.length + Number(n)}`));
    this.params.push(...values);
    return this;
  }

  whereClause(): string { return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : ''; }
  values(): unknown[] { return this.params; }
}
```

利用例:

```ts
const wb = new WhereBuilder();
if (!tenantWide) wb.add('r.created_by_user_id = $1', actor.userId);
if (input.q?.trim()) wb.add('r.title ILIKE $1', `%${input.q.trim()}%`);
if (tenantWide && input.retiredRequesterOnly) wb.add(`cu.status = 'inactive'`);
wb.add(filter === 'scheduled'
  ? `r.status = 'draft' AND r.scheduled_at IS NOT NULL`
  : `r.status <> 'draft'`);
// SELECT ... FROM ... ${wb.whereClause()}
```

`listSentRequests` と `countSentRequestsByFilter` の WHERE 組み立てを 1 個の builder で書き直し、テスト 8 件をそのまま流す。同 PR 内で他の動的 WHERE 構築箇所 (`audit-log/list.ts`, `admin/users.ts`) も同パターンが該当するか棚卸しし、機械的に置換できるならまとめて差し替える。

H に設定した理由: 純粋に「後で直す」では同パターンが NDG-63 などで増える可能性が高く、過去にバグ (NDG-81) を実際に発生させた前科がある。

## M 級（v0.24 バッチ）

### E1: マジック文字列の型化

文字列リテラルが散在している主な領域:

- **ロール文字列** `'tenant_admin'` / `'tenant_wide_requester'` / `'manager'` / `'auditor'` / `'platform_admin'` — `src/` 配下 13 ファイル
- **audit_log action** `'request.cancelled'` / `'request.scheduled_cancelled'` / `'assignment.substituted'` / `'admin.user.roles_changed'` 等 — 11 ファイル (生 INSERT 18 箇所)
- **notification.kind** `'created'` / `'reminder_before'` / `'due_today'` / `'re_notify'` / `'completed'` / `'cancelled'` — 4〜5 箇所
- **assignment.status** `'unopened'` / `'opened'` / `'responded'` / `'substituted'` / `'forwarded'` / `'exempted'` / `'not_needed'` / `'expired'` — `list-sent.ts` 等で複数定義
- **request.status** `'draft'` / `'active'` / `'closed'` / `'cancelled'`

推奨: `src/domain/_constants.ts` に const + リテラル型ユニオンで集約。例:

```ts
export const ROLE = {
  TENANT_ADMIN: 'tenant_admin',
  TENANT_WIDE_REQUESTER: 'tenant_wide_requester',
  MANAGER: 'manager',
  AUDITOR: 'auditor',
  PLATFORM_ADMIN: 'platform_admin',
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];

export const AUDIT_ACTION = {
  REQUEST_CREATED: 'request.created',
  REQUEST_CANCELLED: 'request.cancelled',
  REQUEST_SCHEDULED_CANCELLED: 'request.scheduled_cancelled',
  // ... 18 種類
} as const;
```

加えて [src/domain/audit-log/emit.ts](../../src/domain/audit-log/emit.ts) 新設で `emitAuditLog(client, {action: AUDIT_ACTION.X, ...})` のヘルパー化。これは A1 S9 (audit log 網羅性) と同じ PR で対応すると効率良い。

### E5: API レスポンス形状の一貫性

48 ファイル 211 箇所の `NextResponse.json(...)` を grep した結果、混在パターン:

| 形状 | 用途 | 例 |
|---|---|---|
| `{error: msg}` | invalid json / forbidden / not found 等 | `'invalid json'`, `'memo required'` |
| `{error: msg, code: 'xxx'}` | DomainError からの変換 | `RequestCancelError`, `AIConfigError` |
| `{ok: true}` | 副作用のみ成功 | groups DELETE, settings PUT |
| `{items: [...]}` | 一覧 | templates GET |
| `{...result}` | オブジェクトをそのまま | createRequest, getAIConfigView |

問題:
- DomainError → status code マッピングが 各 route で if/else を書いている（permission_denied → 403, validation → 400 等）。AI config / cancel / templates / settings 全部に同じ pattern。**修正したいときに全 route を辿る必要**
- フロントは `data.error ?? \`エラー (${res.status})\`` で error メッセージを取るが、`code` がある場合の活用が薄い

推奨:
1. `src/api/_lib/respond.ts` に共通 `mapDomainError(err)` を実装:
   ```ts
   export function mapDomainError(err: unknown): NextResponse | null {
     if (err instanceof DomainError) {
       const status = ERROR_CODE_TO_STATUS[err.code];
       return NextResponse.json({ error: err.message, code: err.code }, { status });
     }
     return null; // 呼び出し側で throw
   }
   ```
2. 各 route の catch ブロックを `const r = mapDomainError(err); if (r) return r; throw err;` に置換
3. ok/error shape を 2 種類に集約: `{data: T}` か `{error: string, code: ErrorCode}`。ただし破壊的変更なので v0.24 で大々的にやるのではなく、新規 route から段階適用

### E6: クライアント Dialog + state パターン (5 箇所重複)

該当ファイル:
- [scheduled-cancel-button.tsx](../../src/ui/components/scheduled-cancel-button.tsx)
- [ai-format-modal.tsx](../../src/ui/components/ai-format-modal.tsx)
- [requester-reassign-action.tsx](../../src/ui/components/requester-reassign-action.tsx)
- [sent-card-actions.tsx](../../src/ui/components/sent-card-actions.tsx) (Dialog 2 つ)
- [action-buttons.tsx](../../src/ui/components/action-buttons.tsx)

各ファイルが `useState` 4〜6 個 (`open` / `busy` / `error` / `saved` / `result` / ...) を独自に書いている。

推奨: `src/ui/hooks/use-async-action.ts` を新設:

```ts
type AsyncActionState<T> = { busy: boolean; error: string; result: T | null };
export function useAsyncAction<T>(fn: () => Promise<T>) {
  const [state, setState] = useState<AsyncActionState<T>>({ busy: false, error: '', result: null });
  const run = async () => {
    setState({ busy: true, error: '', result: null });
    try { const result = await fn(); setState({ busy: false, error: '', result }); return result; }
    catch (e) { setState({ busy: false, error: e instanceof Error ? e.message : 'エラー', result: null }); throw e; }
  };
  return { ...state, run, reset: () => setState({ busy: false, error: '', result: null }) };
}
```

加えて確認系の典型用に `<ConfirmDialog title body danger? onConfirm />` を 1 ファイル切る。5 箇所の Dialog 利用を順次このプリミティブ + フックに寄せ、各 component の行数を 1/3 程度に。

### E7: route 内 SQL 直書き

13 ファイルが `withTenant(appPool(), ...)` を直接呼んでいる。内訳:

- **Pages (10 ファイル)**: 軽い role 確認 / org units 取得など。許容範囲（domain helper に上げる必要はないが、共通 helper化 [`requireTenantAdmin(actor)`] 等の選択肢はある）
- **API routes (3 ファイル)**:
  - [`app/t/[code]/api/requests/[id]/route.ts`](../../app/t/%5Bcode%5D/api/requests/%5Bid%5D/route.ts) GET — **~70 行の SQL + ロジック**。リクエスト詳細 + 権限 4 種類 (creator / assignee / wide / subordinate manager) + myAssignment 取得。完全に domain helper の責務
  - [`app/t/[code]/api/me/org-units/route.ts`](../../app/t/%5Bcode%5D/api/me/org-units/route.ts) — 20 行、許容範囲
  - [`app/t/[code]/api/assignments/route.ts`](../../app/t/%5Bcode%5D/api/assignments/route.ts) — 棚卸し時に未確認

推奨:
- まず `requests/[id]/route.ts` GET の SQL ロジックを `src/domain/request/get-detail.ts` に抽出 (`RequestDetailError` + `getRequestDetail(actor, requestId)` を切る)
- 同パターンが将来増えないよう、A2/B (リファクタ実施) では route 新設時に「SQL は domain に書く」のチェック観点を追加（CONTRIBUTING.md or PR テンプレ）

## L 級（観察記録）

### E3: AIProvider と Channel 抽象の不揃い

- [`src/notification/channel.ts`](../../src/notification/channel.ts) は `interface Channel { type, send(ctx, settings) }`、`ChannelError` 付き
- [`src/domain/ai/provider.ts`](../../src/domain/ai/provider.ts) は `interface AIProvider { formatRequest(memo) }`、`AIFormatError` 付き

両者「外部サービスを叩く抽象」として相似だが命名と shape が違う:
- メソッド名: `send` vs `formatRequest`
- 設定の渡し方: 第二引数 `settings` vs コンストラクタで保持
- エラー型: `ChannelError.code` は 2 種類、`AIFormatError.code` は 6 種類

どちらも単独では機能しており、新規プロバイダ追加に対する拡張容易性は十分。**統合や命名揃えは現時点では過剰**で、3 つ目の似た抽象 (e.g. KC sync provider) が出てきたタイミングで再考する方が良い。

### E4: マイグレーション前方互換

抜き取り検証した結果、既存 54 本のマイグレーションは概ね適切:

- `ALTER TABLE ... ADD COLUMN ... NOT NULL` には必ず `DEFAULT` を付与している ([migrations/021_tenant_auth_mode.sql:1](../../migrations/021_tenant_auth_mode.sql#L1))
- CHECK 制約変更は `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT` パターン ([migrations/027_request_target_all_and_action_at.sql:4-15](../../migrations/027_request_target_all_and_action_at.sql#L4-L15))
- 列追加 (053/054) は nullable で追加してコード側で扱う、明示的に良い設計

懸念は v0.24 で発生しうる「旧列 DROP」（[migrations/054](../../migrations/054_tenant_sync_secret_encrypted.sql) で残した `sync_client_secret` 平文列）の段階を踏むこと。これは別チケットの実施手順で扱えば良い。

## 次アクション

1. **NDG-88 (E2)**: `WhereBuilder` 抽象 + `listSentRequests` / `countSentRequestsByFilter` 置換 → 単独 PR、優先
2. **NDG-89 (M 級バッチ)**: E1 + E5 + E6 + E7 を v0.24 リファクタの 1 バッチで PR 化。A3 性能棚卸し完了後に着手
3. **NDG-87 follow-up** (前回検出した assignment-substitute test の transition_kind 誤判定) も M 級として同バッチに含めるかを A3 終了時に判断
