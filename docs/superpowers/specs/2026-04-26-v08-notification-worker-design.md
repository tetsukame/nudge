# v0.8 通知ワーカー + リマインド配信 設計仕様

**ステータス**: 承認済み
**作成日**: 2026-04-26
**スコープ**: バックグラウンドワーカープロセスを新設し、通知の実配信（メール）+ 期限ベースのリマインド生成を実装する。Teams / Slack / 完了通知 / リトライ / 通知設定 UI は v0.9 へ。

---

## 1. スコープと基本方針

v0.8 は v0.5–v0.7 で生成済みの `notification` テーブル行を実際に配信するためのインフラと、リマインド系（期限N日前 / 当日 / 超過後）の自動生成を追加する。

**含むもの**:
- 別プロセスのワーカー（`pnpm worker`）
- Channel 抽象化（v0.9 で Teams/Slack 追加しやすくする）
- メール配信実装（nodemailer + SMTP）
- リマインド生成スケジューラ（reminder_before / due_today / re_notify）
- SMTP 設定 + リマインド設定の DB 保存（migration 030）
- SMTP パスワード AES-256-GCM 暗号化
- emitNotification の拡張（テナント設定に応じた複数チャネル行 INSERT）

**含まないもの**:
- Teams Webhook 配信（v0.9）
- Slack Webhook 配信（v0.9）
- 配信失敗のリトライ（v0.9）
- `kind='completed'`（依頼完了通知）の発火点追加（v0.9）
- 通知設定の管理 UI（v0.9。v0.8 は `tenant_notification_config` / `notification_rule` を psql で直接編集する運用）
- 期限切れバッチ処理（assignment.status='expired' 自動更新）— 引き続き表示のみで判定

---

## 2. アーキテクチャ

```
[Web プロセス]            [Worker プロセス]
  Next.js                   pnpm worker (常駐)
     │                          │
     │ 依頼作成等で              │ 1分ごとに pending を取得
     │ notification 行を         │ → 各行を Channel で送信
     │ INSERT (v0.5)            │ → status を sent / failed に更新
     │                          │
     │   ┌────────────────────┐ │
     └──▶│ notification table  │◀┘
         │  (status, channel)  │
         └────────────────────┘
           ▲
           │ tick (1分ごと)
           │ - リマインド N日前 / 当日 / 超過 を生成
         [Scheduler]
```

**プロセス構成**:
- `web` プロセス: 既存の Next.js（変更なし）
- `worker` プロセス: 新規。`pnpm worker` で起動、内部で 1 分ごとのループ

**Worker の責務**:
1. **Scheduler tick** — `tenant_notification_config` を見て、リマインド対象 assignment を抽出 → `notification` に pending 行を INSERT（idempotent）
2. **Sender tick** — `notification` の pending 行を取得 → `Channel.send()` → status 更新

**運用構成**:
- Docker Compose: `web` と `worker` の 2 サービス
- セルフホスト: `pnpm dev` (web) + `pnpm worker:dev` (worker) で並行起動
- 本番: systemd で 2 ユニット、または PM2 で 2 プロセス

---

## 3. マイグレーション 030

```sql
-- 030: Add SMTP config and reminder settings to tenant_notification_config

ALTER TABLE tenant_notification_config
  ADD COLUMN IF NOT EXISTS smtp_host TEXT,
  ADD COLUMN IF NOT EXISTS smtp_port INTEGER,
  ADD COLUMN IF NOT EXISTS smtp_user TEXT,
  ADD COLUMN IF NOT EXISTS smtp_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS smtp_from TEXT,
  ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_before_days INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS re_notify_interval_days INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS re_notify_max_count INTEGER NOT NULL DEFAULT 5;
```

**項目の意味**:
- `smtp_*` — SMTP サーバー設定。パスワードは AES-256-GCM で暗号化保存。鍵は `IRON_SESSION_PASSWORD` から PBKDF2 で導出
- `reminder_before_days` — 期限の N 日前にリマインド（既定 1）
- `re_notify_interval_days` — 期限超過後 M 日ごとに再通知（既定 3）
- `re_notify_max_count` — 超過リマインドの最大回数（暴走防止、既定 5）

---

## 4. Worker プロセス

**`src/worker/main.ts`** — エントリポイント

- `pnpm worker` で起動
- 環境変数: `DATABASE_URL_APP`, `IRON_SESSION_PASSWORD`
- 1 分ごとに `tick()` を実行
- SIGTERM/SIGINT で graceful shutdown（実行中の tick 完了を待ってから終了）

**`package.json` に追加**:
```json
{
  "scripts": {
    "worker": "tsx src/worker/main.ts",
    "worker:dev": "tsx watch src/worker/main.ts"
  }
}
```

**ループ構成**:
```ts
async function tick(pool: pg.Pool): Promise<void> {
  await runScheduler(pool);   // リマインド生成
  await runSender(pool);      // pending 通知の送信
}
```

### 4.1 Scheduler — `src/worker/scheduler.ts`

各テナントについて以下を実行（idempotent）:

- **reminder_before**: `due_at - reminder_before_days = today` の active 依頼の未終端 assignee に対して、まだ `kind='reminder_before'` の通知が無ければ INSERT
- **due_today**: `due_at = today` の未終端 assignee に対して、まだ `kind='due_today'` 通知が無ければ INSERT
- **re_notify**: `due_at < today` の未終端 assignee に対して、最後の `kind='re_notify'` から `re_notify_interval_days` 経過、かつ送信済み件数 < `re_notify_max_count` なら INSERT

すべて `INSERT ... SELECT ... WHERE NOT EXISTS (matching notification)` で重複防止。

各 INSERT は `emitNotification` ロジックを通すことで、テナント設定に応じた複数チャネル行を生成。

### 4.2 Sender — `src/worker/sender.ts`

```sql
SELECT ... FROM notification
 WHERE status='pending' AND scheduled_at <= now()
 ORDER BY scheduled_at
 LIMIT 100
 FOR UPDATE SKIP LOCKED
```

各行について：
- チャネルに対応する `Channel` 実装を取得
- `recipient_user_id` から user 取得、tenant config 取得
- `channel.send(...)` を呼ぶ
- 成功なら `UPDATE status='sent', sent_at=now()`
- 失敗なら `UPDATE status='failed', attempt_count=attempt_count+1, error_message=...`

`SKIP LOCKED` で複数 worker プロセス並走でも重複送信なし。

### 4.3 Graceful shutdown

```ts
let stopRequested = false;
process.on('SIGTERM', () => { stopRequested = true; });
process.on('SIGINT', () => { stopRequested = true; });

while (!stopRequested) {
  await tick(pool);
  if (stopRequested) break;
  await sleep(60_000);
}
await pool.end();
```

---

## 5. Channel 抽象化

**`src/notification/channel.ts`**:

```ts
export type NotificationContext = {
  notificationId: string;
  tenantId: string;
  requestId: string | null;
  assignmentId: string | null;
  recipientUserId: string;
  recipientEmail: string;
  recipientName: string;
  kind: 'created' | 'reminder_before' | 'due_today' | 're_notify' | 'completed';
  payload: Record<string, unknown>;
};

export interface Channel {
  readonly type: 'in_app' | 'email' | 'teams' | 'slack';
  send(ctx: NotificationContext, tenantConfig: TenantNotificationConfig): Promise<void>;
}

export class ChannelError extends Error {
  constructor(message: string, readonly code: 'config_missing' | 'transport_error') {
    super(message);
  }
}
```

**`src/notification/channels/in-app.ts`** — no-op（DB 上の通知行自体がアプリ内通知）

**`src/notification/channels/email.ts`** — nodemailer + SMTP
- SMTP 未設定なら `ChannelError('config_missing')`
- 暗号化パスワードは `decryptSmtpPassword` で復号
- 送信先は `recipientEmail`、件名/本文は `renderEmail(ctx)`

**`src/notification/channel-registry.ts`** — チャネル選択
```ts
const channels: Record<string, Channel> = {
  in_app: new InAppChannel(),
  email: new EmailChannel(),
};
export function getChannel(type: string): Channel | null {
  return channels[type] ?? null;
}
```

Teams / Slack は v0.9 で `channels/teams.ts`, `channels/slack.ts` を追加して registry に登録するだけ。

---

## 6. メールテンプレート

**`src/notification/render-email.ts`** — `(ctx) => { subject, text }` の単一エントリ

5 つの kind に対応した日本語の件名/本文を返す（プレーンテキスト、HTML なし）：
- `created`: 「【Nudge】依頼が届きました: {title}」
- `reminder_before`: 「【Nudge】期限が近づいています: {title}」
- `due_today`: 「【Nudge】本日が期限です: {title}」
- `re_notify`: 「【Nudge】期限超過のご連絡: {title}」
- `completed`: 「【Nudge】依頼が完了されました: {title}」

宛先名は `recipientName` を本文冒頭に挿入。`completed` は v0.8 ではテンプレートのみ用意し、発火点追加は v0.9。

---

## 7. SMTP パスワード暗号化

**`src/notification/crypto.ts`**:

```ts
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto';

const ALG = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT = 'nudge-smtp-v1';

function deriveKey(): Buffer {
  return pbkdf2Sync(process.env.IRON_SESSION_PASSWORD!, SALT, 100_000, KEY_LEN, 'sha256');
}

export function encryptSmtpPassword(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, enc, tag].map((b) => b.toString('base64')).join('.');
}

export function decryptSmtpPassword(encoded: string): string {
  const [ivB64, encB64, tagB64] = encoded.split('.');
  const decipher = createDecipheriv(ALG, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}
```

**改ざん検知**: AES-GCM の認証タグで担保。タグ不一致なら `decipher.final()` が throw。

---

## 8. emitNotification の拡張

v0.5 の `emitNotification` は `channel='in_app'` 1 行のみ INSERT。v0.8 では テナント rule に応じて複数チャネル行を作成。

**`src/domain/notification/emit.ts`** を拡張:

```ts
async function getChannelsForKind(
  client: pg.PoolClient,
  tenantId: string,
  kind: NotificationKind,
): Promise<string[]> {
  const { rows } = await client.query<{ channels: string[] }>(
    `SELECT channels FROM notification_rule
      WHERE tenant_id=$1 AND kind=$2 LIMIT 1`,
    [tenantId, kind],
  );
  if (rows.length === 0) {
    return ['in_app', 'email']; // default
  }
  return rows[0].channels;
}

export async function emitNotification(
  client: pg.PoolClient,
  input: EmitInput,
): Promise<void> {
  const channels = await getChannelsForKind(client, input.tenantId, input.kind);
  for (const channel of channels) {
    await client.query(
      `INSERT INTO notification
         (tenant_id, request_id, assignment_id, recipient_user_id,
          channel, kind, scheduled_at, status, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, now(), 'pending', $7::jsonb)`,
      [
        input.tenantId, input.requestId, input.assignmentId,
        input.recipientUserId, channel, input.kind, JSON.stringify(input.payload),
      ],
    );
  }
}
```

**互換性**: 既存の `notification_rule` テーブル（migration 015）を活用。テナントが rule を未設定の場合は `['in_app', 'email']` をデフォルト使用。

呼び出し側（`createRequest`, `forwardAssignment`, `substituteAssignment`）は変更不要。

---

## 9. ファイル構造

**新規**:
- `migrations/030_smtp_and_reminders.sql`
- `src/worker/main.ts`
- `src/worker/scheduler.ts`
- `src/worker/sender.ts`
- `src/notification/channel.ts`
- `src/notification/channel-registry.ts`
- `src/notification/channels/in-app.ts`
- `src/notification/channels/email.ts`
- `src/notification/render-email.ts`
- `src/notification/crypto.ts`
- `src/notification/types.ts`（TenantNotificationConfig 型）
- `tests/schema/smtp-and-reminders.test.ts`
- `tests/unit/notification/crypto.test.ts`
- `tests/unit/notification/render-email.test.ts`
- `tests/unit/notification/channels/in-app.test.ts`
- `tests/unit/notification/channels/email.test.ts`
- `tests/unit/worker/scheduler.test.ts`
- `tests/unit/worker/sender.test.ts`
- `tests/integration/worker-tick.test.ts`
- `tests/integration/email-send.test.ts`

**変更**:
- `src/domain/notification/emit.ts` — 複数チャネル INSERT に拡張
- `package.json` — `worker` / `worker:dev` script + `nodemailer` 依存追加
- `tests/unit/domain/notification/emit.test.ts` — テナント rule に応じたチャネル数テスト追加

---

## 10. テスト戦略

### 10.1 スキーマ
- `smtp-and-reminders.test.ts` — migration 030 のカラム検証

### 10.2 ユニット
- `crypto.test.ts` — encrypt/decrypt round-trip、改ざん検知（タグ書き換え → throw）
- `render-email.test.ts` — 5 つの kind それぞれで subject/text 生成
- `channels/email.test.ts` — `nodemailer.createTransport({ jsonTransport: true })` で送信内容検証、SMTP 未設定で `ChannelError`
- `channels/in-app.test.ts` — no-op を確認
- `worker/scheduler.test.ts` — 3 種類のリマインド生成、重複防止、`re_notify_max_count` 上限
- `worker/sender.test.ts` — pending → send → status 更新、失敗時の attempt_count
- `domain/notification/emit.test.ts`（追加） — テナント rule に応じた複数チャネル INSERT

### 10.3 統合
- `worker-tick.test.ts` — testcontainer で 1 tick → リマインド生成 → 送信（メール nodemailer モック）→ DB 反映
- `email-send.test.ts` — `jsonTransport` で実際の Mail オブジェクトを生成して中身検証

### 10.4 手動
- `pnpm worker:dev` 起動 → 依頼作成 → 1 分以内に in_app=sent + email=sent
- MailHog（Docker）を立てて SMTP 受信を目視確認する手順を README に追加
- リマインドのテストは `due_at` を過去に設定 + `re_notify_interval_days=0` で即時再通知を確認

---

## 11. 新規依存パッケージ

- `nodemailer` — メール送信
- `@types/nodemailer`（dev） — 型定義

---

## 12. 運用注意

- worker プロセスは 1 インスタンスでも複数でも動く（SKIP LOCKED で重複なし）
- worker が一時停止しても `notification` 行は pending のまま残るので、復旧時に追いつく
- SMTP 接続失敗は status='failed' になりリトライしない（v0.9 でリトライ追加）
- パスワード暗号化鍵は `IRON_SESSION_PASSWORD` 由来 — このパスワードを変更すると既存暗号化値が復号不能になる点に注意（v0.9 で鍵ローテーション対応検討）
