# データ保持期間 (retention) 設計

ステータス: **設計確定** (NDG-87 / v0.24)
作成日: 2026-05-31 / 確定: 2026-06-06
親チケット: A3 性能棚卸し ([docs/refactor/performance-audit-v0.23.md](performance-audit-v0.23.md) P3)
行政職員向け運用マニュアル: [Notion ドキュメント DB](https://app.notion.com/p/377062c9be5c81d5bca5c228054ae002)

## 背景

v0.23 時点で **無制限に成長するテーブルが 4 つ** あり、retention 戦略がない:

| テーブル | 成長要因 | 推定速度 (中規模 tenant) |
|---|---|---|
| `notification` | 依頼ごと assignee 数 × channel 数 (最大 4) | 40k 行/月/tenant |
| `audit_log` | 全 mutation ≥ 1 行 | 1k 行/日/tenant |
| `assignment_status_history` | 依頼ごと assignee 数 × status 遷移回数 | 300 行/依頼 |
| `sync_log` | KC 同期実行ごと 1 行 | 24 行/日/tenant |

このまま放置すると 1〜2 年で:
- ディスク使用量が線形に膨らみ、バックアップ / レプリケーション コストに反映
- `audit_log` の `/audit` 画面で OFFSET 後半が seq scan 化 (A3 P4 と複合)
- 「いつ・どう減らすか」を運用者がドキュメントなしで判断することになる

## 設計方針

### 1. 「保持」と「削除」を 1 つのモデルで扱う

保持 = 設定された期間内のレコードは残す
削除 = 期間を過ぎたレコードは消す

両者を 1 個の **`retention_config`** テーブル + **`retention_runner` worker tick** に集約。tenant 単位で上書き可能、tenant 未設定なら **platform デフォルト** にフォールバック。

### 2. tenant 上書きを必須にする

業界規制で audit_log を 7 年保持しなければならない顧客 (医療 / 金融 / 公共) と、月単位で十分な顧客 (ライト用途) を 1 つの DB で扱う前提。tenant 上書きなしの単一値ではどちらかが破綻する。

### 3. 削除はソフト → ハードの 2 段階方式

- **ソフト段階**: `archived_at` 列をセット (論理削除)。一覧 UI から消えるが PG 内には残る → 万が一の誤削除をリカバリ可能
- **ハード段階**: `archived_at` 設定後 N 日 (デフォルト 7 日) 経過したら物理 DELETE

「ハード DELETE まで一気にやらない」のは、運用者が retention 設定を誤って 1 日にしてしまった等のリカバリ余地を残すため。

### 4. デフォルトは「無効化」

OSS デフォルト、既存の v0.23 までデプロイ済み環境では `enabled=false` で挙動が一切変わらない。tenant_admin が明示的に有効化したテナントだけが retention の対象。

## データモデル案

### `retention_config` (新規テーブル / migration 055)

```sql
CREATE TABLE retention_config (
  tenant_id            UUID PRIMARY KEY REFERENCES tenant(id),
  enabled              BOOLEAN NOT NULL DEFAULT false,
  notification_days    INT,     -- NULL = platform デフォルト
  audit_log_days       INT,
  history_days         INT,     -- assignment_status_history
  sync_log_days        INT,
  soft_delete_grace_days INT NOT NULL DEFAULT 7,
  extras               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS は tenant_admin だけが読み書きするので不要 (admin pool 経由のみアクセス)
```

### 既存テーブルへの `archived_at` 列追加

```sql
ALTER TABLE notification              ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE audit_log                 ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE assignment_status_history ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE sync_log                  ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX notification_archived_idx
  ON notification (archived_at) WHERE archived_at IS NOT NULL;
-- (同じパターンで他 3 つも)
```

部分インデックスで「ハード DELETE 候補」を高速に拾えるようにする。

### platform デフォルト値

`platform_settings` (既存テーブル) か `loadConfig()` (env 経由) に下記既定を置く:

| 列 | 既定値 (案) | 根拠 |
|---|---|---|
| `notification_days` | 90 | sent / failed の通知は再送候補にはならない |
| `audit_log_days` | 730 (2 年) | 一般的なコンプライアンス目線 |
| `history_days` | 365 (1 年) | 依頼の事後分析には十分 |
| `sync_log_days` | 90 | エラー履歴は短期で十分 |

## 削除メカニズム

### worker tick (新規 `src/worker/retention.ts`)

既存 `src/worker/main.ts` の 60s tick に乗せ、**1 時間に 1 回** のチェック:

```
runRetention(pool):
  for each tenant with retention_config.enabled = true:
    cfg = load(tenant_id) merged with platform defaults
    if cfg.notification_days:
      # ソフト
      UPDATE notification SET archived_at = now()
        WHERE tenant_id = $1 AND archived_at IS NULL
              AND status IN ('sent','failed','skipped')
              AND created_at < now() - INTERVAL '$cfg.notification_days days'
        LIMIT 5000   # 1 tick 上限
      # ハード
      DELETE FROM notification
        WHERE tenant_id = $1 AND archived_at IS NOT NULL
              AND archived_at < now() - INTERVAL '$cfg.soft_delete_grace_days days'
        LIMIT 5000
    # 同パターンで audit_log / assignment_status_history / sync_log
```

LIMIT 5000 は 1 tick で詰まらない範囲。tenant 数 × テーブル数で分散実行。

### 安全装置

- 各 LIMIT 内の処理を 1 トランザクションで囲み、途中失敗時は ROLLBACK
- 削除した件数を `retention_log` テーブル (新規) に記録 (どの tenant / どのテーブル / いつ / 何件)
- platform_admin の `/root/retention` 画面で進捗を可視化

## 既存データへの初回適用

v0.23 までデプロイ済みの環境に migration 055 を打つ時:
- `enabled=false` がデフォルトなので **何も削除されない**
- platform_admin が `/root/retention` で初回有効化する際、UI で「過去のレコードが N 件あります。すぐに削除しますか？」の確認を出す
- 「すぐ削除」を選ぶと worker 次 tick で archived_at = now() が立つ
- 「段階的に」を選ぶと過去 1 年は手付かず、新規発生分から計算が始まる (`created_at < (有効化日 - retention_days)` のみ対象)

## 監査要件

audit_log 自体を消すのは「監査記録の消去」という業務的に重い行為。次のガード:

1. 削除前に **`audit_log.retention.expired`** という audit_log を 1 行記録 (どの期間が消えるか / 件数 / 実行 actor)
2. tenant_admin の retention 設定変更も `settings.retention.changed` で audit_log に残す
3. ハード DELETE 段階を **オプトイン**: `retention_config.hard_delete_enabled` を別フラグにして、デフォルトでは soft (archived_at) のみ。tenant_admin が明示的に有効化しないと PG からは消えない

これで「削除した形跡」が retention_log に最低 1 行残る。

## 決定事項 (2026-06-06 確定)

設計レビューで合意した事項:

1. **soft → hard の grace 期間 = 7 日** (デフォルト)。30 日案も検討したが、論理段階で 7 日あれば誤設定気付くには十分で、ストレージ削減効果との bilance を取る
2. **tenant_admin の retention 設定 UI は v0.25 にリリース**。v0.24 では API のみ提供し、tenant 設定変更は platform_admin の SQL or `/root/retention` で実行。3 か月程度の運用を経てから UI 投資を判断
3. **`assignment_status_history` は `WHERE r.status IN ('closed', 'cancelled')` 限定で削除**。active 中の依頼の遷移履歴は差し戻し対応根拠として保持する
4. **`audit_log` 保持期間は単一 2 年で開始**。業界別プリセット (general/healthcare/finance) は実需要が出てから別チケットで導入。tenant 上書きで個別対応可能なため、デフォルトの過剰一般化を避ける
5. **削除後の集計値の維持は不要**。grep 確認の結果、`/admin` に「過去 N 期間の通知失敗率」等の統計表示は現状なし。要望が発生したら月次集計テーブルの追加で対応
6. **DB size 実測は設計確定後 / 実装着手前に実施**。本設計の「効果見込み」が運用判断のキー指標になるため、実装 PR の前段で測って数値を記録する

## 残課題

実装 PR 着手前に行うこと:
- dev DB の各対象テーブル size 実測 (`SELECT pg_size_pretty(pg_total_relation_size('notification'))` 等)
- 既存環境の `archived_at` 列追加 (migration 055) に伴うロック時間の見立て (テーブルが既に大きいとき、`ADD COLUMN` のロック時間)

## 推奨次アクション

1. 本設計 PR (NDG-87) を一旦レビュー → 上記 1〜6 を ユーザー判断
2. 合意後、**実装 PR を 3 つに分割** (Notion 実 ID は合意後に notion-create-pages で採番):
   - 実装 PR 1: migration 055 (`retention_config` + 各テーブル `archived_at`) + tenant_admin API
   - 実装 PR 2: worker `runRetention` + `retention_log` テーブル
   - 実装 PR 3: `/admin/settings/retention` UI + `/root/retention` 監視ダッシュボード

## 関連

- A1 セキュリティ S9 (audit_log の網羅性) → retention 実装時に「retention 自体の audit」を含めることで部分カバー
- A3 性能 P4 (OFFSET pagination) → audit_log の総件数を抑えれば pagination 性能の悪化も緩和
