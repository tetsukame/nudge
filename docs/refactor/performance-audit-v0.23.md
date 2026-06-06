# 性能棚卸し (v0.23)

作成日: 2026-05-31
対象コミット: main @ 99fa32a (A1/A2 棚卸し完了後)

## 目的

利用ユーザ数・レコード数が伸びた時に **「いつ・どこから」遅くなるか** を机上で見立てる。動的計測は範囲外で、コードと SQL を読んでの構造的問題のみを棚卸し。

## サマリ

| # | 項目 | 深刻度 | 推奨対応 | 状態 |
|---|---|---|---|---|
| P1 | 主要 WHERE / ORDER BY 列のインデックス被覆 | L | 既存 index が必要なクエリパスをほぼ網羅。要監視 | 観察 |
| P2 | emit 系の N+1 (channel × assignee) | L | チャネル数は最大 4、bounded fan-out。問題化したら一括 INSERT 化 | 観察 |
| P3 | 無制限成長テーブル (notification / audit_log / assignment_status_history / sync_log) | **H** | retention policy + archive 戦略の設計 (テナント / 全体オプション) | 設計 PR 先行 |
| P4 | OFFSET pagination の限界 | M | seek pagination 化 (`WHERE created_at < $cursor ORDER BY created_at DESC LIMIT N`) | v0.24 バッチ |
| P5 | COUNT(\*) と一覧クエリの 2 連射 | L | list-sent.ts は E2 リファクタで builder 化したついでに見直す | NDG-88 と同梱 |
| P6 | `withTenant` の per-call トランザクション | M | 読み取り専用パス用に `withTenantReadOnly` (BEGIN なし、`SET LOCAL` を pool-level) を切る | v0.24 バッチ |
| P7 | 通知ワーカーの batch / lock | L | `BATCH_SIZE=100` + `FOR UPDATE SKIP LOCKED` で head-of-line を回避済み、十分 | 観察 |
| P8 | RSC ページの直列 `withTenant` 連発 | M | 1 page = 1 トランザクションに統合 (例: `/requests/new` は 3 連、AI 有効判定込みで非効率) | v0.24 バッチ |
| P9 | Markdown 一覧描画コスト | L | 一覧では本文を出していないので問題ない (RequestCard は title / due / progress のみ) | 観察 |
| P10 | KC sync のメモリ・通信 | L | 数千ユーザ程度では問題なし。万単位以降に再計測 | 観察 |

H 1 件、M 3 件、L 6 件。**H は単純な「列追加」では済まず設計判断を伴う** ため、A1 の H 級と違い「棚卸し → 設計 PR → 実装 PR」の流れになる。

## H 級（設計 PR 先行）

### P3: 無制限成長テーブル

#### 観測

以下のテーブルに **archive / purge / retention の仕組みがない**。grep で `DELETE FROM notification` / `DELETE FROM audit_log` 等を確認したが、コードベース内では一切呼ばれていない:

| テーブル | 増加トリガ | 推定速度 |
|---|---|---|
| `notification` | 依頼作成 / リマインド / 取り消し / 期限通知 → assignee 数 × channel 数 (最大 4) 行追加 | 1 依頼 = 100 件×4ch = 400 行、月 100 依頼で 40k 行/月/tenant |
| `audit_log` | 全 mutation でほぼ 1 件以上記録 (生 INSERT が src/ 配下 18 箇所) | 1 mutation = 1 行、活発な tenant なら 1k 行/日/tenant |
| `assignment_status_history` | 各 assignment の status 遷移ごとに 1 行 | 1 依頼 = 100 件 × 平均 3 遷移 = 300 行/依頼 |
| `sync_log` | KC 同期実行ごとに 1 行 | 60 分間隔で 24 行/日/tenant、月 700 行 |

#### 影響

- `notification` は worker が `WHERE status = 'pending' AND scheduled_at <= now()` で部分 index をスキャンするので、status='sent' / 'failed' の **積み重なりが直接の遅さには出にくい** ものの、ディスク使用量が線形に増える
- `audit_log` の `/audit` 画面は `tenant_id, created_at DESC` でページネーション + フィルタ。レコード数が 100 万を超えると OFFSET 後半が seq scan になる (P4 と複合)
- バックアップ / レプリケーション / ストレージコストの面でも数年単位で運用すれば顕著に効いてくる
- **データ削除の意思決定がコードに残っていない**ので、本番運用で「いつ・どう減らすか」を運用者がドキュメント探さねばならない

#### 推奨対応

短絡的に DELETE を書けば終わる話ではない。次の順序を踏む:

1. **設計 PR (NDG-90)**: `docs/refactor/retention-design.md` で次を決める
   - テーブルごとの保持期間案 (例: notification = sent/failed 90 日 / audit_log = 2 年 / sync_log = 1 年 / assignment_status_history = 依頼完了から 1 年)
   - テナント上書き設定の必要性 (規制対応で audit_log を 7 年保持したい等)
   - 削除手段: 物理 DELETE / `archived_at` 論理マーク → 別 DB へ export / partition + drop
   - 削除担当: 同 worker tick / cron 別プロセス / 管理 UI の手動ボタン
   - 既存データへの初回適用方法
2. **実装 PR (NDG-91)**: 設計通りの retention テーブル + worker tick or cron job
3. **migration PR (NDG-92)**: テナント単位の retention 設定列、デフォルトは「無効化（既存挙動）」

設計を急がない場合の暫定対応として、運用者向けに「手動 SQL を打って NN 日以前を消す」スクリプトを `scripts/purge-notification.sql` に置く案もある。

#### A1 セキュリティ観点との関連

audit_log を消すと監査要件を満たさなくなる業務領域がある。tenant 単位で保持期間を変えられるようにする必要 (一部の医療・金融顧客は 7 年以上)。設計 PR の必須項目。

## M 級（v0.24 バッチ）

### P4: OFFSET pagination の限界

OFFSET を使うパターンが 6 ファイル:

- [src/domain/request/list-sent.ts](../../src/domain/request/list-sent.ts) (sent + admin/sent)
- [src/domain/audit-log/list.ts](../../src/domain/audit-log/list.ts)
- [src/domain/admin/users.ts](../../src/domain/admin/users.ts)
- [src/domain/notification/list-failed.ts](../../src/domain/notification/list-failed.ts)
- [src/domain/request/list.ts](../../src/domain/request/list.ts)
- [src/domain/request/assignees.ts](../../src/domain/request/assignees.ts)

PostgreSQL は OFFSET N で N 行をスキップする処理を実行するため、`page=1000, pageSize=20` の場合 20,020 行を取得して 20,000 行を捨てる。100k 行のテーブルで深いページネーションは秒オーダーになる。

#### 推奨対応

- 主要 2 経路 (`audit_log` / `list-sent`) は seek pagination に変える。クライアントは `?cursor=2026-05-30T12:00:00Z` のような **前ページ末尾の created_at + id** を渡し、サーバは `WHERE (created_at, id) < ($cursor_ts, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT N` で取る
- 「N ページ目に飛ぶ」UI を捨てて「もっと見る」リンクのみにする (既に [`sent/page.tsx:120-128`](../../app/t/%5Bcode%5D/sent/page.tsx#L120-L128) はそうなっている)
- `audit_log` だけはエクスポート用途で総件数表示を残し、UI には影響しない範囲で対応

### P6: `withTenant` の per-call トランザクション

[src/db/with-tenant.ts:15-21](../../src/db/with-tenant.ts#L15-L21) で**毎回 `BEGIN` / `SET LOCAL` / `COMMIT`** を実行している。`SET LOCAL` がトランザクション内でのみ効くので必須だが、結果として **読み取り 1 個のためにトランザクションを 1 個** 切っている。

```ts
await client.query('BEGIN');
await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
const result = await fn(client);
await client.query('COMMIT');
```

#### 影響

- 高 RPS (>100 req/s) で WAL flush 回数が上がり、書き込みなしでも `commit` の round-trip コストが効く
- PostgreSQL のロック / MVCC オーバーヘッドが線形に積もる

#### 推奨対応

1. read-only パス用に `withTenantReadOnly(pool, tenantId, fn)` を新設、内側で `START TRANSACTION READ ONLY; SET LOCAL ... ; ROLLBACK;` パターン (READ ONLY だと flush 不要)
2. もしくは `SET` をクライアント取得直後に session var として打ち、トランザクション無しで使う案。ただし pool client が再利用される時に setting がリークする恐れがあるので `pg.Client` の `release` フックで `RESET app.tenant_id` を呼ぶ必要
3. write パスは既存 `withTenant` 維持

簡単な PoC ベンチマーク (pg_bench 風) を伴う設計にしないと「効果」を主張しにくいので、棚卸しでは「課題提起のみ」に留め、実装は NDG-89 (M 級バッチ) で本気のベンチ込みで判断。

### P8: RSC ページの直列 `withTenant` 連発

[app/t/[code]/requests/new/page.tsx](../../app/t/%5Bcode%5D/requests/new/page.tsx) は連続して 3 回の `withTenant` 呼び出し:

1. `isTenantAdmin` 判定 (role select 1 行)
2. `isTenantWideRequester` 判定 (role select 1 行)
3. `aiEnabled` 判定 (tenant_ai_config select 1 行)

各々が独立した PG コネクション取得 + トランザクションを切る。同じトランザクション内なら 3 クエリで済む。

#### 影響

- 1 ページ表示 = 3 × (acquire client + BEGIN + ... + COMMIT) で 数百ms 増加可能性
- 他のページ (`/admin/audit/page.tsx`, `/admin/sent/page.tsx`) も類似パターンが点在

#### 推奨対応

`page.tsx` 内のロール / 設定読み取りを 1 つの helper `loadPageContext(actor, opts)` にまとめる:

```ts
const ctx = await loadPageContext(actor, { needAIEnabled: true });
// → ctx.isTenantAdmin / ctx.isTenantWideRequester / ctx.aiEnabled
```

内部は 1 transaction で 3 select。A2 E7 (route 内 SQL 直書き) の domain helper 化と同じ PR に乗せる。

## L 級（観察記録）

### P1: 主要 WHERE / ORDER BY 列のインデックス被覆

主要 access pattern を grep + index 一覧 ([migrations/*.sql](../../migrations/)) と突き合わせ:

| クエリパターン | 使用 index | 評価 |
|---|---|---|
| `notification WHERE status='pending' AND scheduled_at<=now()` | `notification_pending_idx` (partial) | ✓ |
| `notification WHERE status='failed' AND next_attempt_at<=now()` | `notification_retry_idx` (partial) | ✓ |
| `audit_log WHERE tenant_id=? AND created_at<?` | `audit_log_tenant_created_idx` | ✓ |
| `audit_log WHERE tenant_id=? AND target_type=? AND target_id=?` | `audit_log_tenant_target_idx` | ✓ |
| `assignment WHERE tenant_id=? AND user_id=? AND status IN (...)` | `assignment_tenant_user_status_idx` | ✓ |
| `request WHERE tenant_id=? AND status=? AND due_at<?` | `request_tenant_status_due_idx` | ✓ |
| `request WHERE status='draft' AND scheduled_at IS NOT NULL` | `request_status_scheduled_idx` (NDG-70) | ✓ |
| `request_template WHERE tenant_id=? AND org_unit_id=?` | `request_template_tenant_org_idx` | ✓ |
| `assignment_status_history WHERE assignment_id=? AND to_status=?` | `assignment_status_history_asg_idx` | △ to_status は index 外、行数小なら問題なし |
| `audit_log WHERE target_id=?` (NDG-79 test) | RLS により tenant_id が自動付与され `audit_log_tenant_target_idx` を使う | ✓ |

主要パスはほぼ網羅されている。**「△」の `assignment_status_history` は将来 1 件の assignment に 100+ 遷移が積まれるような業務にならない限り問題ない**。

### P2: emit 系の N+1

[src/domain/notification/emit.ts:51-66](../../src/domain/notification/emit.ts#L51-L66) は channels (最大 4) のループ。assignment 多数の依頼を作る時、create.ts 側でさらに assignees ループから emitNotification を呼ぶので、**1 依頼 = O(assignees × channels) クエリ**。

- bounded fan-out (assignees ≤ 数百、channels ≤ 4)
- 各 INSERT は同じ transaction
- assignees=200 × channels=2 = 400 INSERT は ~50ms 程度、現状の作成 UI のレスポンス感度なら問題なし

最適化案 (将来):
```sql
INSERT INTO notification(...)
SELECT $1, ..., unnest($2::uuid[]) AS recipient_user_id, unnest($3::text[]) AS channel
```
で 1 クエリにまとめる。実装したくなったら個別チケットで。

### P5: COUNT(*) と一覧クエリの 2 連射

list-sent.ts は count 用の subquery + 一覧クエリの 2 回 query。これは E2 (WhereBuilder) の置換 PR でついでに見直す。例:

- count を window function `COUNT(*) OVER ()` で一緒に取る方法もあるが、PG の場合 plan が変わって却って遅くなることが多い
- 現状の 2 回方式で十分。NDG-88 で WhereBuilder ベースに書き換えた上で「同じビルダで count / items を生成」する見やすさ向上を狙う

### P7: 通知ワーカーの batch / lock

[src/worker/sender.ts:78-118](../../src/worker/sender.ts#L78-L118) は:
- `BATCH_SIZE=100` で 1 tick あたり最大 100 件
- `FOR UPDATE SKIP LOCKED` で並列ワーカーが head-of-line をブロックしない
- claim フェーズと send フェーズを分離 (send 中に lock を握り続けない)

設計として十分。ボトルネックは送信側 (SMTP / Teams / Slack API) 側のレート制限になる。

### P9: Markdown 一覧描画コスト

[src/ui/components/request-card.tsx](../../src/ui/components/request-card.tsx) は body を描画していない (title / due / progress のみ)。/sent や /requests の一覧で MarkdownRenderer は呼ばれない。詳細ページのみ 1 回。問題なし。

### P10: KC sync のメモリ・通信

[src/sync/reconciler.ts](../../src/sync/reconciler.ts) は KC からユーザ全件を取得後、PG 側と diff する。数千ユーザ規模では問題ないが、**万単位ユーザの大企業テナント** で:
- メモリに全件保持
- diff の二重 loop が O(N) (set 使ってる範囲)

要計測。優先度低 (現顧客には該当しない)。

## 次アクション

1. **NDG-90 (P3 設計 PR)**: `docs/refactor/retention-design.md` を書く。テーブル別保持期間案 + 削除戦略 + テナント設定 + 既存データ初回対応。**コード変更なし、レビュー → 合意 → 実装 PR**
2. **NDG-88 (E2 + P5)**: WhereBuilder で list-sent / count を統一書き換え (A2 で予告したもの、P5 と同梱)
3. **NDG-91 (M 級バッチ)**: A2 (E1/E5/E6/E7) + A3 (P4/P6/P8) を v0.24 リファクタの 1 大 PR (もしくは分割) で対応。A1 残 M (S5/S8/S9) と統合してもよい

## 全体まとめ (A1 + A2 + A3)

3 棚卸し終了時点の総数:

| 観点 | H | M | L |
|---|---|---|---|
| A1 セキュリティ | 3 (修正済 #74/#75/#76) | 3 (v0.24 バッチ) | 5 |
| A2 拡張性 | 1 (E2) | 4 | 2 |
| A3 性能 | 1 (P3) | 3 | 6 |
| **計** | **5** (うち 3 修正済) | **10** | **13** |

H 残 2 件 = NDG-88 (WhereBuilder, 即実装) + NDG-90 (retention 設計, 設計 PR 先行)
