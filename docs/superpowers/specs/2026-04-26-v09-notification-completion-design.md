# v0.9 通知サブシステム完成 + 設定 UI 設計仕様

**ステータス**: 承認済み
**作成日**: 2026-04-26
**スコープ**: v0.8 で構築した通知配信基盤を「実用レベル」に完成させる。Teams/Slack 配信、指数バックオフリトライ、依頼者向け completed 通知、テナント管理者向け設定 UI を追加。

---

## 1. スコープと基本方針

v0.8 までで通知の基盤（emit → DB → worker → SMTP 配信）は動くが、運用面で穴がある:
- Teams/Slack 配信なし
- 配信失敗のリトライなし
- 依頼者向けの「対応完了」通知なし
- 設定が psql 直接編集

v0.9 はこれら 4 つの穴を埋めて通知サブシステムを完成させる。

**含むもの**:
- TeamsChannel + SlackChannel（Webhook 経由）
- 指数バックオフリトライ（最大 4 回: 1 → 5 → 30 → 120 分）
- `completed` 通知発火点 3 箇所（respond / unavailable / substitute）
- テナント管理者向け通知設定 UI
- Teams/Slack Webhook URL の暗号化保存
- 設定 API（GET/PUT）
- サイドバーに「⚙️ 設定」メニュー追加（tenant_admin ロール限定）

**含まないもの**:
- テスト送信ボタン（v0.10）
- 失敗通知の手動再送（v0.10）
- 監査ログビュー（v0.10）
- ローカル auth モード（v0.10）
- 通知ルール（kind ごとの細かい配信設定）の編集 UI（v0.10+）

---

## 2. アーキテクチャ

v0.8 のプロセス構成（web + worker）に変更なし。Channel 抽象化に 2 種類追加、sender にリトライロジック追加、API + UI を新規追加するのみ。

```
[Web プロセス]                                [Worker プロセス]
  Next.js                                     pnpm worker
     │                                              │
     │ ⚙️ /settings/notification                   │
     │ ↳ tenant_settings UPSERT                    │ 1分ごと:
     │ ↳ tenant_notification_config UPSERT          │  - scheduler
     │                                              │  - sender (リトライ拡張)
     │ 完了アクションで                             │
     │ completed 通知 emit                          │
     │                                              │
     │   ┌────────────────────────────────────────┐ │
     └──▶│ notification + tenant_settings          │◀┘
         └────────────────────────────────────────┘
```

---

## 3. マイグレーション

### 3.1 マイグレーション 032: Webhook URL カラム

```sql
-- 032: Teams and Slack Webhook URLs (encrypted)
ALTER TABLE tenant_settings
  ADD COLUMN teams_webhook_url_encrypted TEXT,
  ADD COLUMN slack_webhook_url_encrypted TEXT;
```

### 3.2 マイグレーション 033: リトライスケジュール用カラム

```sql
-- 033: Schedule next retry attempt for failed notifications
ALTER TABLE notification ADD COLUMN next_attempt_at TIMESTAMPTZ;

CREATE INDEX notification_retry_idx
  ON notification (status, next_attempt_at)
  WHERE status = 'failed' AND next_attempt_at IS NOT NULL;
```

`NULL` = リトライ予定なし（永続失敗 or 未スケジュール）。値あり = その時刻になったら sender が拾う。

---

## 4. 暗号化の汎用化

v0.8 の `src/notification/crypto.ts` の `encryptSmtpPassword` / `decryptSmtpPassword` は内部実装が汎用 AES-256-GCM。Webhook URL にも流用するため、汎用エイリアスを追加：

```ts
// src/notification/crypto.ts (追加)
export const encryptSecret = encryptSmtpPassword;
export const decryptSecret = decryptSmtpPassword;
```

既存の関数名は後方互換のため残す。新規利用は `encryptSecret` / `decryptSecret` を推奨。

---

## 5. リトライ機構

### 5.1 バックオフ計算

**`src/worker/retry.ts`** — 純関数

```ts
export const MAX_ATTEMPT_COUNT = 4;
const BACKOFF_MINUTES = [1, 5, 30, 120];

export function nextAttemptAt(attemptCount: number, now = new Date()): Date | null {
  if (attemptCount >= MAX_ATTEMPT_COUNT) return null;
  const minutes = BACKOFF_MINUTES[attemptCount - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
  return new Date(now.getTime() + minutes * 60 * 1000);
}
```

| attemptCount (失敗後) | 次回までの間隔 |
|---|---|
| 1 | 1 分後 |
| 2 | 5 分後 |
| 3 | 30 分後 |
| 4 | 120 分後（2 時間） |
| 5 以上 | リトライなし（永続失敗、`next_attempt_at = NULL`） |

### 5.2 sender の修正

**claim クエリ拡張**（`src/worker/sender.ts`）:

```sql
SELECT ... FROM notification
 WHERE (status = 'pending' AND scheduled_at <= now())
    OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
 ORDER BY COALESCE(next_attempt_at, scheduled_at)
 LIMIT $1
 FOR UPDATE SKIP LOCKED
```

claim 時は両方を `status='sending'` にする（v0.8 の動作と同じ）。

**`PendingRow` 型に `attempt_count` を追加**（claim クエリでも返す）。

**failure ハンドリング**:

```ts
} catch (err) {
  const newAttemptCount = row.attempt_count + 1;
  const next = nextAttemptAt(newAttemptCount);
  await client.query(
    `UPDATE notification
        SET status = 'failed',
            attempt_count = $2,
            error_message = $3,
            next_attempt_at = $4
      WHERE id = $1`,
    [row.id, newAttemptCount, (err as Error).message, next],
  );
}
```

`next === null` のとき `next_attempt_at = NULL` で UPDATE され、永続失敗扱いになる。

---

## 6. Teams / Slack Channel

### 6.1 共通メッセージテンプレート

**`src/notification/render-message.ts`** — 5 kinds 共通

```ts
import type { NotificationContext } from './channel';

export function renderMessage(ctx: NotificationContext): { title: string; body: string } {
  const title = (typeof ctx.payload.title === 'string' && ctx.payload.title) || '依頼';
  switch (ctx.kind) {
    case 'created':
      return { title: `📋 依頼が届きました`, body: `「${title}」\n\n${ctx.recipientName} さん宛の依頼があります。` };
    case 'reminder_before':
      return { title: `⏰ 期限が近づいています`, body: `「${title}」\n\n${ctx.recipientName} さん、対応をお願いします。` };
    case 'due_today':
      return { title: `🔴 本日が期限です`, body: `「${title}」\n\n${ctx.recipientName} さん、至急対応をお願いします。` };
    case 're_notify':
      return { title: `⚠️ 期限超過`, body: `「${title}」\n\n${ctx.recipientName} さん、ご確認ください。` };
    case 'completed':
      return { title: `✅ 依頼が完了しました`, body: `「${title}」が完了されました。` };
  }
}
```

### 6.2 TeamsChannel

`src/notification/channels/teams.ts`:
- 設定なし → `ChannelError('config_missing')`
- Teams Incoming Webhook 形式: `{ "@type": "MessageCard", "@context": "https://schema.org/extensions", title, text }`
- `text` は改行を `<br>` に置換（Teams は HTML サブセット対応）
- `fetch` に失敗 → `ChannelError('transport_error')`
- レスポンス非 200 → `ChannelError('transport_error')`

### 6.3 SlackChannel

`src/notification/channels/slack.ts`:
- 設定なし → `ChannelError('config_missing')`
- Slack Incoming Webhook 形式: `{ text: "*<title>*\n<body>" }`（最小形式）
- `fetch` に失敗 → `ChannelError('transport_error')`
- レスポンス非 200 → `ChannelError('transport_error')`

### 6.4 Channel registry 拡張

```ts
const channels: Record<string, Channel> = {
  in_app: new InAppChannel(),
  email: new EmailChannel(),
  teams: new TeamsChannel(),
  slack: new SlackChannel(),
};
```

### 6.5 TenantSettings 型拡張

```ts
export type TenantSettings = {
  // ... 既存フィールド
  teamsWebhookUrlEncrypted: string | null;
  slackWebhookUrlEncrypted: string | null;
};
```

`src/worker/sender.ts` の `loadSettings` も対応カラム読み込みを追加。

---

## 7. completed 通知発火

### 7.1 発火点

`src/domain/assignment/actions.ts` の以下 3 関数の最後（status 更新 + history 記録の後）に追加：

- `respondAssignment` (action='responded')
- `unavailableAssignment` (action='unavailable')
- `substituteAssignment` (action='substituted')

`forwardAssignment` / `exemptAssignment` / `openAssignment` は対象外。

### 7.2 自己通知の抑制

依頼者本人が assignee の場合は通知不要：

```ts
if (asg.created_by_user_id !== actor.userId) {
  await emitNotification(client, { ... });
}
```

### 7.3 emit ペイロード

```ts
{
  tenantId: actor.tenantId,
  recipientUserId: asg.created_by_user_id,
  requestId: asg.request_id,
  assignmentId: asg.id,
  kind: 'completed',
  payload: {
    title: <request.title>,
    completedBy: <actor.display_name>,
    action: 'responded' | 'unavailable' | 'substituted',
  },
}
```

### 7.4 request title の取得

`loadLocked` を拡張して `r.title` も返すようにする（追加 SELECT 不要）。

### 7.5 render-email の completed テンプレート拡張

v0.8 で text に「対応者: {completedBy}」を追加：

```ts
case 'completed': {
  const completedBy = (typeof ctx.payload.completedBy === 'string') ? ctx.payload.completedBy : '担当者';
  return {
    subject: `【Nudge】依頼が完了されました: ${title}`,
    text: `${greeting}依頼が完了されました。\n\n依頼: ${title}\n対応者: ${completedBy}`,
  };
}
```

---

## 8. 通知設定 UI

### 8.1 ルート

`/t/<code>/settings/notification`

`tenant_admin` ロール必須。それ以外は 403。layout.tsx で `tenant_admin` ロールクエリを追加し、サイドバーに条件付き表示。

### 8.2 画面構成

```
⚙️ 通知設定
├ 📧 メール（SMTP）
│   ☑ 有効、Host、Port、User、Password（伏字、変更ボタン）、From、☐ TLS
├ 💬 Microsoft Teams
│   ☑/☐ 有効、Webhook URL（伏字、変更ボタン）
├ 💬 Slack
│   ☑/☐ 有効、Webhook URL（伏字、変更ボタン）
├ 🔔 アプリ内通知
│   ☑ 有効
├ ⏰ リマインド設定
│   reminder_before_days、re_notify_interval_days、re_notify_max_count
└ [保存]
```

### 8.3 API

**`GET /t/<code>/api/admin/settings/notification`**

レスポンス（パスワード/Webhook URL は伏字）:
```ts
{
  smtp: { host, port, user, hasPassword: boolean, from, secure },
  teams: { hasWebhookUrl: boolean },
  slack: { hasWebhookUrl: boolean },
  channels: { in_app: boolean, email: boolean, teams: boolean, slack: boolean },
  reminders: { reminderBeforeDays, reNotifyIntervalDays, reNotifyMaxCount },
}
```

**`PUT /t/<code>/api/admin/settings/notification`**

リクエスト:
```ts
{
  smtp: { host?, port?, user?, password?, from?, secure? },
  teams: { webhookUrl? },
  slack: { webhookUrl? },
  channels: { in_app, email, teams, slack },
  reminders: { reminderBeforeDays, reNotifyIntervalDays, reNotifyMaxCount },
}
```

- `password` / `webhookUrl` フィールドが `undefined` のときは既存値を保持（伏字状態で送信されたら未変更扱い）
- `password` / `webhookUrl` フィールドに値が入ったら暗号化して保存
- `tenant_settings` を UPSERT
- `tenant_notification_config` を 4 channel 分 UPSERT（`enabled` 値のみ更新、`config_json` はそのまま）

### 8.4 ファイル構成

```
src/domain/settings/
  get.ts                       ← getNotificationSettings(pool, actor)
  update.ts                    ← updateNotificationSettings(pool, actor, input)
app/t/[code]/api/admin/settings/notification/
  route.ts                     ← GET / PUT
app/t/[code]/settings/notification/
  page.tsx                     ← Server Component (loads initial data)
src/ui/components/
  settings-form.tsx            ← Client Component (form interaction)
  sidebar.tsx                  ← isTenantAdmin prop 追加、admin メニュー条件追加
app/t/[code]/layout.tsx       ← tenant_admin ロール検出
```

### 8.5 権限チェック

route handler の最初に `actor.isTenantAdmin === true` を確認、NG なら 403。

サイドバーの「⚙️ 設定」項目は `isTenantAdmin && isManager` が混在しないよう、独立 prop。

---

## 9. テスト戦略

### 9.1 スキーマ
- `tests/schema/migration-032.test.ts` — Webhook URL カラム検証
- `tests/schema/migration-033.test.ts` — next_attempt_at + retry index 検証

### 9.2 単体（純関数）
- `tests/unit/worker/retry.test.ts` — `nextAttemptAt` の境界値（1 〜 4 と 5 以上）
- `tests/unit/notification/render-message.test.ts` — 5 kinds の出力検証

### 9.3 単体（DB / モック）
- `tests/unit/notification/channels/teams.test.ts` — config_missing、fetch モック、200/非 200、URL 復号
- `tests/unit/notification/channels/slack.test.ts` — 同上
- `tests/unit/domain/settings/get.test.ts` — 伏字化、空テナント初期値
- `tests/unit/domain/settings/update.test.ts` — UPSERT、伏字フィールドの「未送信なら既存維持」
- `tests/unit/domain/assignment/actions.test.ts` 追加 3 ケース：
  - `respondAssignment` で依頼者宛 completed 通知が emit される
  - 依頼者本人が assignee の場合は emit されない
  - `unavailableAssignment` / `substituteAssignment` でも同様
- `tests/unit/worker/sender.test.ts` 追加：
  - 失敗時に `next_attempt_at` がセット、`attempt_count++`
  - 4 回失敗後は `next_attempt_at = NULL`（永続失敗）
  - `status='failed'` でかつ `next_attempt_at <= now()` の行が次の tick で claim される

### 9.4 統合
- `tests/integration/settings-api.test.ts` — GET/PUT、403 for non-admin、伏字、更新が emit に反映
- `tests/integration/worker-retry.test.ts` — 失敗 → 1 分後再試行 → 永続失敗フロー

### 9.5 UI
- `tests/unit/ui/settings-form.test.tsx` — レンダリング、伏字フィールドの「変更」ボタン挙動

### 9.6 手動
- 設定画面で SMTP 設定を入力、依頼作成 → メール届く
- Teams Webhook を設定（テナント側で別途 Webhook URL 取得）、依頼作成 → Teams に投稿される
- 同様に Slack
- 完了アクション後、依頼者に completed 通知届く
- SMTP 故意に壊して失敗確認、1 分後リトライ確認
