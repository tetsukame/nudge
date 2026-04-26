# v0.9 Notification Completion + Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the notification subsystem from v0.8 with Teams/Slack channels, exponential backoff retry, completed-notification emit, and a tenant_admin-only settings UI.

**Architecture:** Add 2 new Channel implementations (Teams/Slack via Webhook), extend sender with retry scheduling, add emit points in 3 assignment actions for `completed`, build a settings page that UPSERTs `tenant_settings` + `tenant_notification_config`. Webhook URLs are encrypted with the existing AES-256-GCM module (aliased as `encryptSecret`).

**Tech Stack:** Node.js, Next.js 15, React 19, PostgreSQL 17, nodemailer, fetch (Web API), vitest

---

## Phase 1: Foundation

### Task 1: Migration 032 — Webhook URL columns

**Files:**
- Create: `migrations/032_tenant_webhook_urls.sql`
- Create: `tests/schema/tenant-webhook-urls.test.ts`

- [ ] **Step 1: Write migration**

```sql
-- 032: Teams and Slack Webhook URLs (encrypted)
ALTER TABLE tenant_settings
  ADD COLUMN teams_webhook_url_encrypted TEXT,
  ADD COLUMN slack_webhook_url_encrypted TEXT;
```

- [ ] **Step 2: Write schema test**

```ts
// tests/schema/tenant-webhook-urls.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 032: tenant_settings webhook URL columns', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('teams_webhook_url_encrypted exists as nullable text', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='tenant_settings' AND column_name='teams_webhook_url_encrypted'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('slack_webhook_url_encrypted exists as nullable text', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='tenant_settings' AND column_name='slack_webhook_url_encrypted'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('text');
    expect(rows[0].is_nullable).toBe('YES');
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
corepack pnpm@9.12.0 vitest run tests/schema/tenant-webhook-urls.test.ts
git add migrations/032_tenant_webhook_urls.sql tests/schema/tenant-webhook-urls.test.ts
git commit -m "feat(db): add Webhook URL encrypted columns to tenant_settings (migration 032)"
```

---

### Task 2: Migration 033 — next_attempt_at + retry index

**Files:**
- Create: `migrations/033_notification_retry.sql`
- Create: `tests/schema/notification-retry.test.ts`

- [ ] **Step 1: Write migration**

```sql
-- 033: Schedule next retry attempt for failed notifications
ALTER TABLE notification ADD COLUMN next_attempt_at TIMESTAMPTZ;

CREATE INDEX notification_retry_idx
  ON notification (status, next_attempt_at)
  WHERE status = 'failed' AND next_attempt_at IS NOT NULL;
```

- [ ] **Step 2: Write schema test**

```ts
// tests/schema/notification-retry.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 033: notification retry', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('next_attempt_at exists as nullable timestamptz', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='notification' AND column_name='next_attempt_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('timestamp with time zone');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('retry index exists', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename='notification' AND indexname='notification_retry_idx'`,
    );
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
corepack pnpm@9.12.0 vitest run tests/schema/notification-retry.test.ts
git add migrations/033_notification_retry.sql tests/schema/notification-retry.test.ts
git commit -m "feat(db): add notification.next_attempt_at + retry index (migration 033)"
```

---

### Task 3: Crypto aliases + TenantSettings extension

**Files:**
- Modify: `src/notification/crypto.ts` (add aliases)
- Modify: `src/notification/types.ts` (add 2 fields)

- [ ] **Step 1: Add aliases to crypto.ts**

Append to `src/notification/crypto.ts`:
```ts
// Generic aliases for encrypting any secret (Webhook URLs, etc.)
export const encryptSecret = encryptSmtpPassword;
export const decryptSecret = decryptSmtpPassword;
```

- [ ] **Step 2: Extend TenantSettings**

Replace `src/notification/types.ts` content:
```ts
export type TenantSettings = {
  tenantId: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPasswordEncrypted: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
  teamsWebhookUrlEncrypted: string | null;
  slackWebhookUrlEncrypted: string | null;
  reminderBeforeDays: number;
  reNotifyIntervalDays: number;
  reNotifyMaxCount: number;
};
```

- [ ] **Step 3: Update sender's loadSettings**

In `src/worker/sender.ts`, modify `loadSettings` to read the new columns. Find the SELECT and the row-to-TenantSettings mapping. Add:

```ts
// In SELECT:
teams_webhook_url_encrypted, slack_webhook_url_encrypted,
// In return:
teamsWebhookUrlEncrypted: r.teams_webhook_url_encrypted,
slackWebhookUrlEncrypted: r.slack_webhook_url_encrypted,
```

Update `DEFAULT_SETTINGS` to include the two new fields with `null`.

- [ ] **Step 4: Typecheck + commit**

```bash
corepack pnpm@9.12.0 exec tsc --noEmit
corepack pnpm@9.12.0 run test:all  # ensure no regressions
git add src/notification/crypto.ts src/notification/types.ts src/worker/sender.ts
git commit -m "feat(notification): generic encryptSecret/decryptSecret aliases + TenantSettings webhook fields"
```

---

## Phase 2: Channels (Teams + Slack + shared render)

### Task 4: render-message — shared Teams/Slack template

**Files:**
- Create: `src/notification/render-message.ts`
- Create: `tests/unit/notification/render-message.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/notification/render-message.test.ts
import { describe, it, expect } from 'vitest';
import { renderMessage } from '../../../src/notification/render-message';
import type { NotificationContext } from '../../../src/notification/channel';

const baseCtx = {
  notificationId: 'n1', tenantId: 't1', requestId: 'r1', assignmentId: null,
  recipientUserId: 'u1', recipientEmail: 'a@b', recipientName: '田中',
  payload: { title: 'テスト依頼' },
};

describe('renderMessage', () => {
  it.each([
    ['created', '届きました'],
    ['reminder_before', '近づいています'],
    ['due_today', '本日が期限'],
    ['re_notify', '期限超過'],
    ['completed', '完了'],
  ] as const)('title for %s contains "%s"', (kind, marker) => {
    const out = renderMessage({ ...baseCtx, kind } as NotificationContext);
    expect(out.title).toContain(marker);
  });

  it('body contains the request title for non-completed kinds', () => {
    const out = renderMessage({ ...baseCtx, kind: 'created' } as NotificationContext);
    expect(out.body).toContain('テスト依頼');
    expect(out.body).toContain('田中');
  });

  it('body contains title for completed', () => {
    const out = renderMessage({ ...baseCtx, kind: 'completed' } as NotificationContext);
    expect(out.body).toContain('テスト依頼');
  });

  it('falls back to "依頼" when payload.title is missing', () => {
    const out = renderMessage({
      ...baseCtx, kind: 'created', payload: {},
    } as NotificationContext);
    expect(out.body).toContain('依頼');
  });
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Implement**

```ts
// src/notification/render-message.ts
import type { NotificationContext } from './channel';

export function renderMessage(ctx: NotificationContext): { title: string; body: string } {
  const title = (typeof ctx.payload.title === 'string' && ctx.payload.title) || '依頼';
  switch (ctx.kind) {
    case 'created':
      return { title: '📋 依頼が届きました', body: `「${title}」\n\n${ctx.recipientName} さん宛の依頼があります。` };
    case 'reminder_before':
      return { title: '⏰ 期限が近づいています', body: `「${title}」\n\n${ctx.recipientName} さん、対応をお願いします。` };
    case 'due_today':
      return { title: '🔴 本日が期限です', body: `「${title}」\n\n${ctx.recipientName} さん、至急対応をお願いします。` };
    case 're_notify':
      return { title: '⚠️ 期限超過', body: `「${title}」\n\n${ctx.recipientName} さん、ご確認ください。` };
    case 'completed':
      return { title: '✅ 依頼が完了しました', body: `「${title}」が完了されました。` };
  }
}
```

- [ ] **Step 4: Run, PASS, commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/notification/render-message.test.ts
git add src/notification/render-message.ts tests/unit/notification/render-message.test.ts
git commit -m "feat(notification): render-message template for Teams/Slack channels"
```

---

### Task 5: TeamsChannel

**Files:**
- Create: `src/notification/channels/teams.ts`
- Create: `tests/unit/notification/channels/teams.test.ts`

- [ ] **Step 1: Write failing test (uses fetch mock)**

```ts
// tests/unit/notification/channels/teams.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TeamsChannel } from '../../../../src/notification/channels/teams';
import { ChannelError } from '../../../../src/notification/channel';
import { encryptSecret } from '../../../../src/notification/crypto';
import type { TenantSettings } from '../../../../src/notification/types';
import type { NotificationContext } from '../../../../src/notification/channel';

const baseCtx: NotificationContext = {
  notificationId: 'n1', tenantId: 't1', requestId: 'r1', assignmentId: null,
  recipientUserId: 'u1', recipientEmail: 'a@b', recipientName: '田中',
  kind: 'created', payload: { title: 'T' },
};

const baseSettings: TenantSettings = {
  tenantId: 't1',
  smtpHost: null, smtpPort: null, smtpUser: null, smtpPasswordEncrypted: null,
  smtpFrom: null, smtpSecure: false,
  teamsWebhookUrlEncrypted: null, slackWebhookUrlEncrypted: null,
  reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5,
};

describe('TeamsChannel', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ChannelError when teams webhook URL not configured', async () => {
    const ch = new TeamsChannel();
    await expect(ch.send(baseCtx, baseSettings)).rejects.toBeInstanceOf(ChannelError);
  });

  it('POSTs to decrypted URL with MessageCard payload on success (200)', async () => {
    const url = 'https://outlook.office.com/webhook/xyz';
    const enc = encryptSecret(url);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const ch = new TeamsChannel();
    await ch.send(baseCtx, { ...baseSettings, teamsWebhookUrlEncrypted: enc });

    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body['@type']).toBe('MessageCard');
    expect(body.title).toContain('届きました');
  });

  it('throws ChannelError on non-2xx response', async () => {
    const url = 'https://outlook.office.com/webhook/xyz';
    const enc = encryptSecret(url);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const ch = new TeamsChannel();
    await expect(
      ch.send(baseCtx, { ...baseSettings, teamsWebhookUrlEncrypted: enc }),
    ).rejects.toBeInstanceOf(ChannelError);
  });

  it('throws ChannelError on fetch failure', async () => {
    const url = 'https://outlook.office.com/webhook/xyz';
    const enc = encryptSecret(url);
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const ch = new TeamsChannel();
    await expect(
      ch.send(baseCtx, { ...baseSettings, teamsWebhookUrlEncrypted: enc }),
    ).rejects.toBeInstanceOf(ChannelError);
  });
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Implement**

```ts
// src/notification/channels/teams.ts
import type { Channel, NotificationContext } from '../channel';
import { ChannelError } from '../channel';
import type { TenantSettings } from '../types';
import { decryptSecret } from '../crypto';
import { renderMessage } from '../render-message';

export class TeamsChannel implements Channel {
  readonly type = 'teams' as const;

  async send(ctx: NotificationContext, settings: TenantSettings): Promise<void> {
    if (!settings.teamsWebhookUrlEncrypted) {
      throw new ChannelError('Teams webhook URL not configured', 'config_missing');
    }
    const url = decryptSecret(settings.teamsWebhookUrlEncrypted);
    const { title, body } = renderMessage(ctx);
    const payload = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      title,
      text: body.replace(/\n/g, '<br>'),
    };
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new ChannelError(
        `Teams webhook fetch failed: ${(err as Error).message}`,
        'transport_error',
      );
    }
    if (!res.ok) {
      throw new ChannelError(`Teams webhook returned ${res.status}`, 'transport_error');
    }
  }
}
```

- [ ] **Step 4: Run, PASS, commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/notification/channels/teams.test.ts
git add src/notification/channels/teams.ts tests/unit/notification/channels/teams.test.ts
git commit -m "feat(notification): TeamsChannel via Incoming Webhook"
```

---

### Task 6: SlackChannel

**Files:**
- Create: `src/notification/channels/slack.ts`
- Create: `tests/unit/notification/channels/slack.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/notification/channels/slack.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SlackChannel } from '../../../../src/notification/channels/slack';
import { ChannelError } from '../../../../src/notification/channel';
import { encryptSecret } from '../../../../src/notification/crypto';
import type { TenantSettings } from '../../../../src/notification/types';
import type { NotificationContext } from '../../../../src/notification/channel';

const baseCtx: NotificationContext = {
  notificationId: 'n1', tenantId: 't1', requestId: 'r1', assignmentId: null,
  recipientUserId: 'u1', recipientEmail: 'a@b', recipientName: '田中',
  kind: 'created', payload: { title: 'T' },
};

const baseSettings: TenantSettings = {
  tenantId: 't1',
  smtpHost: null, smtpPort: null, smtpUser: null, smtpPasswordEncrypted: null,
  smtpFrom: null, smtpSecure: false,
  teamsWebhookUrlEncrypted: null, slackWebhookUrlEncrypted: null,
  reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5,
};

describe('SlackChannel', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('throws ChannelError when slack webhook URL not configured', async () => {
    const ch = new SlackChannel();
    await expect(ch.send(baseCtx, baseSettings)).rejects.toBeInstanceOf(ChannelError);
  });

  it('POSTs to decrypted URL with text payload on success (200)', async () => {
    const url = 'https://hooks.slack.com/services/abc';
    const enc = encryptSecret(url);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const ch = new SlackChannel();
    await ch.send(baseCtx, { ...baseSettings, slackWebhookUrlEncrypted: enc });

    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toContain('届きました');
  });

  it('throws ChannelError on non-2xx response', async () => {
    const url = 'https://hooks.slack.com/services/abc';
    const enc = encryptSecret(url);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const ch = new SlackChannel();
    await expect(
      ch.send(baseCtx, { ...baseSettings, slackWebhookUrlEncrypted: enc }),
    ).rejects.toBeInstanceOf(ChannelError);
  });
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Implement**

```ts
// src/notification/channels/slack.ts
import type { Channel, NotificationContext } from '../channel';
import { ChannelError } from '../channel';
import type { TenantSettings } from '../types';
import { decryptSecret } from '../crypto';
import { renderMessage } from '../render-message';

export class SlackChannel implements Channel {
  readonly type = 'slack' as const;

  async send(ctx: NotificationContext, settings: TenantSettings): Promise<void> {
    if (!settings.slackWebhookUrlEncrypted) {
      throw new ChannelError('Slack webhook URL not configured', 'config_missing');
    }
    const url = decryptSecret(settings.slackWebhookUrlEncrypted);
    const { title, body } = renderMessage(ctx);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `*${title}*\n${body}` }),
      });
    } catch (err) {
      throw new ChannelError(
        `Slack webhook fetch failed: ${(err as Error).message}`,
        'transport_error',
      );
    }
    if (!res.ok) {
      throw new ChannelError(`Slack webhook returned ${res.status}`, 'transport_error');
    }
  }
}
```

- [ ] **Step 4: Run, PASS, commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/notification/channels/slack.test.ts
git add src/notification/channels/slack.ts tests/unit/notification/channels/slack.test.ts
git commit -m "feat(notification): SlackChannel via Incoming Webhook"
```

---

### Task 7: Channel registry update

**Files:**
- Modify: `src/notification/channel-registry.ts`
- Modify: `tests/unit/notification/channel-registry.test.ts`

- [ ] **Step 1: Add tests for teams/slack to existing test file**

In `tests/unit/notification/channel-registry.test.ts`, replace the "returns null for teams/slack/xyz" test with:

```ts
it('returns TeamsChannel for teams', () => {
  expect(getChannel('teams')?.type).toBe('teams');
});

it('returns SlackChannel for slack', () => {
  expect(getChannel('slack')?.type).toBe('slack');
});

it('returns null for unknown type', () => {
  expect(getChannel('xyz')).toBeNull();
});
```

- [ ] **Step 2: Run, FAIL (teams/slack return null currently)**

- [ ] **Step 3: Update registry**

```ts
// src/notification/channel-registry.ts
import type { Channel } from './channel';
import { InAppChannel } from './channels/in-app';
import { EmailChannel } from './channels/email';
import { TeamsChannel } from './channels/teams';
import { SlackChannel } from './channels/slack';

const channels: Record<string, Channel> = {
  in_app: new InAppChannel(),
  email: new EmailChannel(),
  teams: new TeamsChannel(),
  slack: new SlackChannel(),
};

export function getChannel(type: string): Channel | null {
  return channels[type] ?? null;
}
```

- [ ] **Step 4: Run, PASS, commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/notification/channel-registry.test.ts
git add src/notification/channel-registry.ts tests/unit/notification/channel-registry.test.ts
git commit -m "feat(notification): register TeamsChannel and SlackChannel in registry"
```

---

## Phase 3: Retry mechanism

### Task 8: retry.ts pure function

**Files:**
- Create: `src/worker/retry.ts`
- Create: `tests/unit/worker/retry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/worker/retry.test.ts
import { describe, it, expect } from 'vitest';
import { nextAttemptAt, MAX_ATTEMPT_COUNT } from '../../../src/worker/retry';

describe('nextAttemptAt', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  it('schedules 1 minute later for attempt 1', () => {
    const next = nextAttemptAt(1, now);
    expect(next).not.toBeNull();
    expect(next!.getTime() - now.getTime()).toBe(60_000);
  });

  it('schedules 5 minutes later for attempt 2', () => {
    const next = nextAttemptAt(2, now);
    expect(next!.getTime() - now.getTime()).toBe(5 * 60_000);
  });

  it('schedules 30 minutes later for attempt 3', () => {
    const next = nextAttemptAt(3, now);
    expect(next!.getTime() - now.getTime()).toBe(30 * 60_000);
  });

  it('schedules 120 minutes later for attempt 4', () => {
    const next = nextAttemptAt(4, now);
    expect(next!.getTime() - now.getTime()).toBe(120 * 60_000);
  });

  it('returns null for attempt 5 (exceeds MAX)', () => {
    expect(nextAttemptAt(5, now)).toBeNull();
  });

  it('returns null for attempt 100 (exceeds MAX)', () => {
    expect(nextAttemptAt(100, now)).toBeNull();
  });

  it('exports MAX_ATTEMPT_COUNT = 4', () => {
    expect(MAX_ATTEMPT_COUNT).toBe(4);
  });
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Implement**

```ts
// src/worker/retry.ts
export const MAX_ATTEMPT_COUNT = 4;
const BACKOFF_MINUTES = [1, 5, 30, 120];

export function nextAttemptAt(attemptCount: number, now: Date = new Date()): Date | null {
  if (attemptCount > MAX_ATTEMPT_COUNT) return null;
  if (attemptCount < 1) return null;
  const minutes = BACKOFF_MINUTES[attemptCount - 1];
  return new Date(now.getTime() + minutes * 60_000);
}
```

- [ ] **Step 4: Run, PASS, commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/worker/retry.test.ts
git add src/worker/retry.ts tests/unit/worker/retry.test.ts
git commit -m "feat(worker): nextAttemptAt with exponential backoff (1/5/30/120 min)"
```

---

### Task 9: Sender retry support

**Files:**
- Modify: `src/worker/sender.ts`
- Modify: `tests/unit/worker/sender.test.ts`

- [ ] **Step 1: Add failing tests for retry behavior**

Append to `tests/unit/worker/sender.test.ts` (inside existing `describe`):

```ts
  it('failed notification gets next_attempt_at scheduled (1 min for attempt 1)', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'email');

    await runSender(getPool());

    const { rows } = await getPool().query(
      `SELECT status, attempt_count, next_attempt_at FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempt_count).toBe(1);
    expect(rows[0].next_attempt_at).not.toBeNull();
    // Should be roughly 1 minute in the future
    const delta = new Date(rows[0].next_attempt_at).getTime() - Date.now();
    expect(delta).toBeGreaterThan(50_000);
    expect(delta).toBeLessThan(70_000);
  });

  it('failed notification claimable when next_attempt_at <= now', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'email');
    // Pre-mark as failed with next_attempt_at in the past
    await getPool().query(
      `UPDATE notification
          SET status='failed', attempt_count=1,
              next_attempt_at = now() - interval '1 minute'
        WHERE id=$1`,
      [nId],
    );

    await runSender(getPool());

    // Should have been re-attempted (and failed again — still no SMTP)
    const { rows } = await getPool().query(
      `SELECT status, attempt_count, next_attempt_at FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].attempt_count).toBe(2);
    expect(rows[0].next_attempt_at).not.toBeNull(); // 5 min later
  });

  it('5th attempt sets next_attempt_at to NULL (permanent failure)', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'email');
    // Pre-mark as failed at attempt 4 with next in the past
    await getPool().query(
      `UPDATE notification
          SET status='failed', attempt_count=4,
              next_attempt_at = now() - interval '1 minute'
        WHERE id=$1`,
      [nId],
    );

    await runSender(getPool());

    const { rows } = await getPool().query(
      `SELECT status, attempt_count, next_attempt_at FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempt_count).toBe(5);
    expect(rows[0].next_attempt_at).toBeNull();
  });
```

- [ ] **Step 2: Run, FAIL (sender doesn't pick up failed rows or set next_attempt_at)**

- [ ] **Step 3: Modify sender claim query and failure handling**

In `src/worker/sender.ts`:

1. Import `nextAttemptAt` from `./retry`:
   ```ts
   import { nextAttemptAt } from './retry';
   ```

2. Modify the claim query to include retryable failed rows:
   ```sql
   SELECT id, tenant_id, request_id, assignment_id, recipient_user_id,
          channel, kind, payload_json, attempt_count
     FROM notification
    WHERE (status = 'pending' AND scheduled_at <= now())
       OR (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now())
    ORDER BY COALESCE(next_attempt_at, scheduled_at)
    LIMIT $1
    FOR UPDATE SKIP LOCKED
   ```

3. Add `attempt_count: number` to the `PendingRow` type.

4. In the failure UPDATE branch, replace the existing handler with:
   ```ts
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
   ```

5. The success UPDATE remains unchanged (sets status='sent', sent_at=now()), but should also clear next_attempt_at:
   ```sql
   UPDATE notification SET status='sent', sent_at=now(), next_attempt_at=NULL WHERE id=$1
   ```

- [ ] **Step 4: Run, PASS, commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/worker/sender.test.ts
corepack pnpm@9.12.0 run test:all  # ensure no regressions
git add src/worker/sender.ts tests/unit/worker/sender.test.ts
git commit -m "feat(worker): sender retry with exponential backoff via next_attempt_at"
```

---

## Phase 4: completed notification emit

### Task 10: completed emit in 3 actions

**Files:**
- Modify: `src/domain/assignment/actions.ts`
- Modify: `tests/unit/domain/assignment/actions.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/unit/domain/assignment/actions.test.ts`:

```ts
  it('respondAssignment emits completed notification to requester', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, {});

    const { rows } = await getPool().query(
      `SELECT recipient_user_id, channel, kind, payload_json
         FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2`,
      [requestId, s.users.admin],
    );
    expect(rows.length).toBeGreaterThan(0);
    const inApp = rows.find((r) => r.channel === 'in_app');
    expect(inApp).toBeDefined();
    expect(inApp!.payload_json.action).toBe('responded');
  });

  it('respondAssignment does NOT emit completed when requester is also the assignee', async () => {
    const s = await createDomainScenario(getPool());
    // admin creates a request to admin (self)
    const reqId = randomUUID();
    await getPool().query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','self','active')`,
      [reqId, s.tenantId, s.users.admin],
    );
    const { rows: asgRows } = await getPool().query<{ id: string }>(
      `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1,$2,$3) RETURNING id`,
      [s.tenantId, reqId, s.users.admin],
    );
    const assignmentId = asgRows[0].id;

    await respondAssignment(getAppPool(), ctx(s, s.users.admin), assignmentId, {});

    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification
        WHERE request_id=$1 AND kind='completed'`,
      [reqId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('unavailableAssignment emits completed with action=unavailable', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await unavailableAssignment(
      getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: 'busy' },
    );

    const { rows } = await getPool().query(
      `SELECT payload_json FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2 AND channel='in_app'`,
      [requestId, s.users.admin],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.action).toBe('unavailable');
  });

  it('substituteAssignment emits completed with action=substituted', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.admin), assignmentId, { reason: 'taking over' },
    );

    const { rows } = await getPool().query(
      `SELECT payload_json FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2 AND channel='in_app'`,
      [requestId, s.users.admin],
    );
    // admin is the requester AND the substituting actor — self-completion suppression?
    // Per spec: "if asg.created_by_user_id !== actor.userId" — admin IS the requester so suppressed.
    expect(rows.length).toBe(0);
  });

  it('substituteAssignment by non-requester emits completed', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    // manager substitutes (manager is not the requester, admin is)
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.manager), assignmentId, { reason: 'manager step in' },
    );
    const { rows } = await getPool().query(
      `SELECT payload_json FROM notification
        WHERE request_id=$1 AND kind='completed' AND recipient_user_id=$2 AND channel='in_app'`,
      [requestId, s.users.admin],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].payload_json.action).toBe('substituted');
  });
```

(Add `import { randomUUID } from 'node:crypto';` at the top if not present.)

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Modify actions.ts**

In `src/domain/assignment/actions.ts`:

1. Modify `loadLocked` to also return `request.title`:
   ```sql
   SELECT a.id, a.request_id, a.user_id, a.status::text AS status,
          r.created_by_user_id, r.title AS request_title
     FROM assignment a
     JOIN request r ON r.id = a.request_id
    WHERE a.id = $1
    FOR UPDATE OF a
   ```
   Update `AssignmentRow` type:
   ```ts
   type AssignmentRow = {
     id: string;
     request_id: string;
     user_id: string;
     status: AssignmentStatus;
     created_by_user_id: string;
     request_title: string;
   };
   ```

2. Add a helper at top of file (after imports):
   ```ts
   async function emitCompletedToRequester(
     client: pg.PoolClient,
     actor: ActorContext,
     asg: AssignmentRow,
     action: 'responded' | 'unavailable' | 'substituted',
   ): Promise<void> {
     if (asg.created_by_user_id === actor.userId) return; // suppress self-completion
     const { rows: actorRows } = await client.query<{ display_name: string }>(
       `SELECT display_name FROM users WHERE id = $1`,
       [actor.userId],
     );
     const completedBy = actorRows[0]?.display_name ?? 'ユーザー';
     await emitNotification(client, {
       tenantId: actor.tenantId,
       recipientUserId: asg.created_by_user_id,
       requestId: asg.request_id,
       assignmentId: asg.id,
       kind: 'completed',
       payload: {
         title: asg.request_title,
         completedBy,
         action,
       },
     });
   }
   ```

3. In `respondAssignment`, after the existing `recordHistory` call:
   ```ts
   await emitCompletedToRequester(client, actor, asg, 'responded');
   ```

4. In `unavailableAssignment`, after `recordHistory`:
   ```ts
   await emitCompletedToRequester(client, actor, asg, 'unavailable');
   ```

5. In `substituteAssignment`, after the existing system-message insert (which is in the `if (actor.userId !== asg.user_id)` block):
   ```ts
   // Outside that if-block — runs always:
   await emitCompletedToRequester(client, actor, asg, 'substituted');
   ```

- [ ] **Step 4: Update render-email completed template**

In `src/notification/render-email.ts`, replace the `case 'completed'` block:
```ts
case 'completed': {
  const completedBy = (typeof ctx.payload.completedBy === 'string' && ctx.payload.completedBy) || '担当者';
  return {
    subject: `【Nudge】依頼が完了されました: ${title}`,
    text: `${greeting}依頼が完了されました。\n\n依頼: ${title}\n対応者: ${completedBy}`,
  };
}
```

- [ ] **Step 5: Run actions test + render-email test**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/actions.test.ts tests/unit/notification/render-email.test.ts
```

Update `render-email.test.ts` if any existing test checks the completed text content; add an assertion that `'対応者: 担当者'` (or specified completedBy) appears.

- [ ] **Step 6: Run full suite + commit**

```bash
corepack pnpm@9.12.0 run test:all
git add src/domain/assignment/actions.ts src/notification/render-email.ts \
        tests/unit/domain/assignment/actions.test.ts \
        tests/unit/notification/render-email.test.ts
git commit -m "feat(domain): emit completed notification on respond/unavailable/substitute (suppress self-completion)"
```

---

## Phase 5: Settings UI

### Task 11: domain settings get/update

**Files:**
- Create: `src/domain/settings/get.ts`
- Create: `src/domain/settings/update.ts`
- Create: `tests/unit/domain/settings/get.test.ts`
- Create: `tests/unit/domain/settings/update.test.ts`

- [ ] **Step 1: Write failing test for get**

```ts
// tests/unit/domain/settings/get.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { encryptSecret } from '../../../../src/notification/crypto';
import { getNotificationSettings } from '../../../../src/domain/settings/get';
import type { ActorContext } from '../../../../src/domain/types';

function adminCtx(tenantId: string, userId: string): ActorContext {
  return { userId, tenantId, isTenantAdmin: true, isTenantWideRequester: false };
}

describe('getNotificationSettings', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('returns defaults when no rows exist', async () => {
    const s = await createDomainScenario(getPool());
    const result = await getNotificationSettings(getAppPool(), adminCtx(s.tenantId, s.users.admin));
    expect(result.smtp.host).toBeNull();
    expect(result.smtp.hasPassword).toBe(false);
    expect(result.teams.hasWebhookUrl).toBe(false);
    expect(result.slack.hasWebhookUrl).toBe(false);
    expect(result.channels).toEqual({ in_app: false, email: false, teams: false, slack: false });
    expect(result.reminders.reminderBeforeDays).toBe(1);
  });

  it('masks password and webhook URLs (hasX flags only)', async () => {
    const s = await createDomainScenario(getPool());
    await getPool().query(
      `INSERT INTO tenant_settings(tenant_id, smtp_host, smtp_password_encrypted,
                                   teams_webhook_url_encrypted, slack_webhook_url_encrypted)
       VALUES ($1, 'smtp.example.com', $2, $3, $4)`,
      [
        s.tenantId,
        encryptSecret('secret-pass'),
        encryptSecret('https://outlook.office.com/webhook/xyz'),
        encryptSecret('https://hooks.slack.com/services/abc'),
      ],
    );
    const result = await getNotificationSettings(getAppPool(), adminCtx(s.tenantId, s.users.admin));
    expect(result.smtp.host).toBe('smtp.example.com');
    expect(result.smtp.hasPassword).toBe(true);
    expect(result.teams.hasWebhookUrl).toBe(true);
    expect(result.slack.hasWebhookUrl).toBe(true);
    // Encrypted values must NOT leak
    expect(JSON.stringify(result)).not.toContain('secret-pass');
    expect(JSON.stringify(result)).not.toContain('outlook.office.com');
  });

  it('reads channel enabled flags from tenant_notification_config', async () => {
    const s = await createDomainScenario(getPool());
    for (const ch of ['in_app', 'email']) {
      await getPool().query(
        `INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, channel) DO UPDATE SET enabled = true`,
        [s.tenantId, ch],
      );
    }
    const result = await getNotificationSettings(getAppPool(), adminCtx(s.tenantId, s.users.admin));
    expect(result.channels.in_app).toBe(true);
    expect(result.channels.email).toBe(true);
    expect(result.channels.teams).toBe(false);
    expect(result.channels.slack).toBe(false);
  });
});
```

- [ ] **Step 2: Implement get.ts**

```ts
// src/domain/settings/get.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type NotificationSettingsView = {
  smtp: {
    host: string | null;
    port: number | null;
    user: string | null;
    hasPassword: boolean;
    from: string | null;
    secure: boolean;
  };
  teams: { hasWebhookUrl: boolean };
  slack: { hasWebhookUrl: boolean };
  channels: { in_app: boolean; email: boolean; teams: boolean; slack: boolean };
  reminders: {
    reminderBeforeDays: number;
    reNotifyIntervalDays: number;
    reNotifyMaxCount: number;
  };
};

export async function getNotificationSettings(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<NotificationSettingsView> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: settingRows } = await client.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
              smtp_from, smtp_secure,
              teams_webhook_url_encrypted, slack_webhook_url_encrypted,
              reminder_before_days, re_notify_interval_days, re_notify_max_count
         FROM tenant_settings WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const s = settingRows[0];

    const { rows: channelRows } = await client.query<{ channel: string; enabled: boolean }>(
      `SELECT channel, enabled FROM tenant_notification_config
        WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const channels = { in_app: false, email: false, teams: false, slack: false };
    for (const r of channelRows) {
      if (r.channel in channels) {
        (channels as Record<string, boolean>)[r.channel] = r.enabled;
      }
    }

    return {
      smtp: {
        host: s?.smtp_host ?? null,
        port: s?.smtp_port ?? null,
        user: s?.smtp_user ?? null,
        hasPassword: !!s?.smtp_password_encrypted,
        from: s?.smtp_from ?? null,
        secure: s?.smtp_secure ?? false,
      },
      teams: { hasWebhookUrl: !!s?.teams_webhook_url_encrypted },
      slack: { hasWebhookUrl: !!s?.slack_webhook_url_encrypted },
      channels,
      reminders: {
        reminderBeforeDays: s?.reminder_before_days ?? 1,
        reNotifyIntervalDays: s?.re_notify_interval_days ?? 3,
        reNotifyMaxCount: s?.re_notify_max_count ?? 5,
      },
    };
  });
}
```

- [ ] **Step 3: Run get test, commit get**

- [ ] **Step 4: Write failing test for update**

```ts
// tests/unit/domain/settings/update.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { encryptSecret, decryptSecret } from '../../../../src/notification/crypto';
import { updateNotificationSettings, SettingsUpdateError } from '../../../../src/domain/settings/update';
import type { ActorContext } from '../../../../src/domain/types';

function adminCtx(tenantId: string, userId: string): ActorContext {
  return { userId, tenantId, isTenantAdmin: true, isTenantWideRequester: false };
}
function nonAdminCtx(tenantId: string, userId: string): ActorContext {
  return { userId, tenantId, isTenantAdmin: false, isTenantWideRequester: false };
}

describe('updateNotificationSettings', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('rejects non-admin with SettingsUpdateError', async () => {
    const s = await createDomainScenario(getPool());
    await expect(
      updateNotificationSettings(getAppPool(), nonAdminCtx(s.tenantId, s.users.memberA), {
        smtp: {}, teams: {}, slack: {},
        channels: { in_app: true, email: false, teams: false, slack: false },
        reminders: { reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5 },
      }),
    ).rejects.toBeInstanceOf(SettingsUpdateError);
  });

  it('encrypts password and webhook URLs on UPSERT', async () => {
    const s = await createDomainScenario(getPool());
    await updateNotificationSettings(getAppPool(), adminCtx(s.tenantId, s.users.admin), {
      smtp: { host: 'smtp.example.com', port: 587, user: 'u', password: 'plain-pass', from: 'a@b', secure: false },
      teams: { webhookUrl: 'https://outlook.office.com/webhook/xxx' },
      slack: { webhookUrl: 'https://hooks.slack.com/services/yyy' },
      channels: { in_app: true, email: true, teams: true, slack: true },
      reminders: { reminderBeforeDays: 2, reNotifyIntervalDays: 5, reNotifyMaxCount: 3 },
    });
    const { rows } = await getPool().query(
      `SELECT smtp_password_encrypted, teams_webhook_url_encrypted, slack_webhook_url_encrypted
         FROM tenant_settings WHERE tenant_id=$1`,
      [s.tenantId],
    );
    expect(decryptSecret(rows[0].smtp_password_encrypted)).toBe('plain-pass');
    expect(decryptSecret(rows[0].teams_webhook_url_encrypted)).toBe('https://outlook.office.com/webhook/xxx');
    expect(decryptSecret(rows[0].slack_webhook_url_encrypted)).toBe('https://hooks.slack.com/services/yyy');
  });

  it('preserves existing password when password field is omitted', async () => {
    const s = await createDomainScenario(getPool());
    await getPool().query(
      `INSERT INTO tenant_settings(tenant_id, smtp_password_encrypted) VALUES ($1, $2)`,
      [s.tenantId, encryptSecret('existing-pass')],
    );
    await updateNotificationSettings(getAppPool(), adminCtx(s.tenantId, s.users.admin), {
      smtp: { host: 'smtp.new', port: 25 },  // no password field
      teams: {}, slack: {},
      channels: { in_app: true, email: false, teams: false, slack: false },
      reminders: { reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5 },
    });
    const { rows } = await getPool().query(
      `SELECT smtp_password_encrypted, smtp_host FROM tenant_settings WHERE tenant_id=$1`,
      [s.tenantId],
    );
    expect(decryptSecret(rows[0].smtp_password_encrypted)).toBe('existing-pass');
    expect(rows[0].smtp_host).toBe('smtp.new');
  });

  it('UPSERTs tenant_notification_config for all 4 channels', async () => {
    const s = await createDomainScenario(getPool());
    await updateNotificationSettings(getAppPool(), adminCtx(s.tenantId, s.users.admin), {
      smtp: {}, teams: {}, slack: {},
      channels: { in_app: true, email: true, teams: false, slack: false },
      reminders: { reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5 },
    });
    const { rows } = await getPool().query<{ channel: string; enabled: boolean }>(
      `SELECT channel, enabled FROM tenant_notification_config
        WHERE tenant_id=$1 ORDER BY channel`,
      [s.tenantId],
    );
    expect(rows).toHaveLength(4);
    const map = Object.fromEntries(rows.map((r) => [r.channel, r.enabled]));
    expect(map.in_app).toBe(true);
    expect(map.email).toBe(true);
    expect(map.teams).toBe(false);
    expect(map.slack).toBe(false);
  });
});
```

- [ ] **Step 5: Implement update.ts**

```ts
// src/domain/settings/update.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { encryptSecret } from '../../notification/crypto';

export class SettingsUpdateError extends Error {
  constructor(msg: string, readonly code: 'permission_denied' | 'validation') {
    super(msg);
    this.name = 'SettingsUpdateError';
  }
}

export type UpdateSettingsInput = {
  smtp: {
    host?: string | null;
    port?: number | null;
    user?: string | null;
    password?: string;     // if undefined, preserve existing
    from?: string | null;
    secure?: boolean;
  };
  teams: { webhookUrl?: string };  // if undefined, preserve existing
  slack: { webhookUrl?: string };
  channels: { in_app: boolean; email: boolean; teams: boolean; slack: boolean };
  reminders: {
    reminderBeforeDays: number;
    reNotifyIntervalDays: number;
    reNotifyMaxCount: number;
  };
};

const ALL_CHANNELS = ['in_app', 'email', 'teams', 'slack'] as const;

export async function updateNotificationSettings(
  pool: pg.Pool,
  actor: ActorContext,
  input: UpdateSettingsInput,
): Promise<void> {
  if (!actor.isTenantAdmin) {
    throw new SettingsUpdateError('tenant_admin required', 'permission_denied');
  }

  await withTenant(pool, actor.tenantId, async (client) => {
    // Load existing tenant_settings (for preserving secrets on omit)
    const { rows: existingRows } = await client.query(
      `SELECT smtp_password_encrypted, teams_webhook_url_encrypted,
              slack_webhook_url_encrypted
         FROM tenant_settings WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const existing = existingRows[0];

    const smtpPasswordEncrypted = input.smtp.password !== undefined
      ? encryptSecret(input.smtp.password)
      : (existing?.smtp_password_encrypted ?? null);

    const teamsWebhookEncrypted = input.teams.webhookUrl !== undefined
      ? encryptSecret(input.teams.webhookUrl)
      : (existing?.teams_webhook_url_encrypted ?? null);

    const slackWebhookEncrypted = input.slack.webhookUrl !== undefined
      ? encryptSecret(input.slack.webhookUrl)
      : (existing?.slack_webhook_url_encrypted ?? null);

    await client.query(
      `INSERT INTO tenant_settings(
         tenant_id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
         smtp_from, smtp_secure,
         teams_webhook_url_encrypted, slack_webhook_url_encrypted,
         reminder_before_days, re_notify_interval_days, re_notify_max_count
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id) DO UPDATE SET
         smtp_host = EXCLUDED.smtp_host,
         smtp_port = EXCLUDED.smtp_port,
         smtp_user = EXCLUDED.smtp_user,
         smtp_password_encrypted = EXCLUDED.smtp_password_encrypted,
         smtp_from = EXCLUDED.smtp_from,
         smtp_secure = EXCLUDED.smtp_secure,
         teams_webhook_url_encrypted = EXCLUDED.teams_webhook_url_encrypted,
         slack_webhook_url_encrypted = EXCLUDED.slack_webhook_url_encrypted,
         reminder_before_days = EXCLUDED.reminder_before_days,
         re_notify_interval_days = EXCLUDED.re_notify_interval_days,
         re_notify_max_count = EXCLUDED.re_notify_max_count,
         updated_at = now()`,
      [
        actor.tenantId,
        input.smtp.host ?? null,
        input.smtp.port ?? null,
        input.smtp.user ?? null,
        smtpPasswordEncrypted,
        input.smtp.from ?? null,
        input.smtp.secure ?? false,
        teamsWebhookEncrypted,
        slackWebhookEncrypted,
        input.reminders.reminderBeforeDays,
        input.reminders.reNotifyIntervalDays,
        input.reminders.reNotifyMaxCount,
      ],
    );

    for (const ch of ALL_CHANNELS) {
      const enabled = input.channels[ch];
      await client.query(
        `INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, channel) DO UPDATE
            SET enabled = EXCLUDED.enabled, updated_at = now()`,
        [actor.tenantId, ch, enabled],
      );
    }
  });
}
```

- [ ] **Step 6: Run + commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/domain/settings/
git add src/domain/settings/ tests/unit/domain/settings/
git commit -m "feat(domain): notification settings get + update with masked-secret preservation"
```

---

### Task 12: Settings API route

**Files:**
- Create: `app/t/[code]/api/admin/settings/notification/route.ts`
- Create: `tests/integration/settings-api.test.ts`

- [ ] **Step 1: Create the route handler**

```ts
// app/t/[code]/api/admin/settings/notification/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { getNotificationSettings } from '@/domain/settings/get';
import {
  updateNotificationSettings,
  SettingsUpdateError,
  type UpdateSettingsInput,
} from '@/domain/settings/update';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;
  if (!guard.actor.isTenantAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const result = await getNotificationSettings(appPool(), guard.actor);
  return NextResponse.json(result);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    await updateNotificationSettings(appPool(), guard.actor, body as UpdateSettingsInput);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof SettingsUpdateError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Write integration test**

```ts
// tests/integration/settings-api.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { GET, PUT } from '../../app/t/[code]/api/admin/settings/notification/route.js';

describe('settings API', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('GET returns 403 for non-admin', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/settings/notification`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(403);
  });

  it('GET as admin returns masked settings', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/settings/notification`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.smtp.hasPassword).toBe(false);
    expect(body.channels).toHaveProperty('in_app');
  });

  it('PUT updates settings and GET reflects them', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const putBody = {
      smtp: { host: 'smtp.api.test', port: 587, user: 'u', password: 'p', from: 'f@x', secure: false },
      teams: {}, slack: {},
      channels: { in_app: true, email: true, teams: false, slack: false },
      reminders: { reminderBeforeDays: 2, reNotifyIntervalDays: 5, reNotifyMaxCount: 3 },
    };
    const putRes = await PUT(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/settings/notification`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(putBody),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(putRes.status).toBe(200);

    const getRes = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/admin/settings/notification`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const body = await getRes.json();
    expect(body.smtp.host).toBe('smtp.api.test');
    expect(body.smtp.hasPassword).toBe(true);
    expect(body.channels.email).toBe(true);
    expect(body.reminders.reminderBeforeDays).toBe(2);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
corepack pnpm@9.12.0 vitest run tests/integration/settings-api.test.ts
git add app/t/[code]/api/admin/settings/notification/route.ts \
        tests/integration/settings-api.test.ts
git commit -m "feat(api): notification settings GET/PUT (tenant_admin only)"
```

---

### Task 13: Settings UI page + sidebar menu

**Files:**
- Create: `app/t/[code]/settings/notification/page.tsx`
- Create: `src/ui/components/settings-form.tsx`
- Modify: `src/ui/components/sidebar.tsx`
- Modify: `app/t/[code]/layout.tsx`

- [ ] **Step 1: Update layout to detect tenant_admin role**

In `app/t/[code]/layout.tsx`, after the existing `isManager` query, add a `tenant_admin` check:

```ts
const isTenantAdmin = await withTenant(appPool(), session.tenantId, async (client) => {
  const { rows } = await client.query(
    `SELECT 1 FROM user_role WHERE user_id = $1 AND role = 'tenant_admin' LIMIT 1`,
    [session.userId],
  );
  return rows.length > 0;
});
```

Pass `isTenantAdmin={isTenantAdmin}` to `<Sidebar>`.

- [ ] **Step 2: Update Sidebar to accept isTenantAdmin prop**

In `src/ui/components/sidebar.tsx`:

1. Update Props type: add `isTenantAdmin: boolean`
2. After the manager menu logic, if `isTenantAdmin`, append `{ href: 'settings/notification', label: '通知設定', icon: '⚙️' }` to navItems.

```ts
type Props = {
  tenantCode: string;
  displayName: string;
  isManager: boolean;
  isTenantAdmin: boolean;
};

// Inside component, after computing navItems with isManager:
const finalNavItems = isTenantAdmin
  ? [...navItems, { href: 'settings/notification', label: '通知設定', icon: '⚙️' }]
  : navItems;
// Use finalNavItems in JSX.
```

- [ ] **Step 3: Create settings page**

```tsx
// app/t/[code]/settings/notification/page.tsx
import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { getNotificationSettings } from '@/domain/settings/get';
import { SettingsForm } from '@/ui/components/settings-form';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default async function NotificationSettingsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) redirect(`/t/${code}/login`);

  const isTenantAdmin = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM user_role WHERE user_id = $1 AND role = 'tenant_admin' LIMIT 1`,
      [session.userId],
    );
    return rows.length > 0;
  });
  if (!isTenantAdmin) redirect(`/t/${code}/requests`);

  const initial = await getNotificationSettings(appPool(), {
    userId: session.userId,
    tenantId: session.tenantId,
    isTenantAdmin: true,
    isTenantWideRequester: false,
  });

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <h1 className="text-xl font-bold mb-6">⚙️ 通知設定</h1>
      <SettingsForm tenantCode={code} initial={initial} />
    </div>
  );
}
```

- [ ] **Step 4: Create SettingsForm Client Component**

```tsx
// src/ui/components/settings-form.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  tenantCode: string;
  initial: {
    smtp: { host: string | null; port: number | null; user: string | null; hasPassword: boolean; from: string | null; secure: boolean };
    teams: { hasWebhookUrl: boolean };
    slack: { hasWebhookUrl: boolean };
    channels: { in_app: boolean; email: boolean; teams: boolean; slack: boolean };
    reminders: { reminderBeforeDays: number; reNotifyIntervalDays: number; reNotifyMaxCount: number };
  };
};

export function SettingsForm({ tenantCode, initial }: Props) {
  const router = useRouter();
  const [smtp, setSmtp] = useState({
    host: initial.smtp.host ?? '',
    port: initial.smtp.port ?? 587,
    user: initial.smtp.user ?? '',
    from: initial.smtp.from ?? '',
    secure: initial.smtp.secure,
  });
  const [smtpPassword, setSmtpPassword] = useState<string | null>(null); // null = preserve existing
  const [teamsUrl, setTeamsUrl] = useState<string | null>(null);
  const [slackUrl, setSlackUrl] = useState<string | null>(null);
  const [channels, setChannels] = useState(initial.channels);
  const [reminders, setReminders] = useState(initial.reminders);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSave() {
    setSaving(true);
    setMessage('');
    const body = {
      smtp: {
        host: smtp.host || null,
        port: smtp.port || null,
        user: smtp.user || null,
        ...(smtpPassword !== null ? { password: smtpPassword } : {}),
        from: smtp.from || null,
        secure: smtp.secure,
      },
      teams: teamsUrl !== null ? { webhookUrl: teamsUrl } : {},
      slack: slackUrl !== null ? { webhookUrl: slackUrl } : {},
      channels,
      reminders,
    };
    try {
      const res = await fetch(
        `/t/${tenantCode}/api/admin/settings/notification`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (res.ok) {
        setMessage('保存しました');
        setSmtpPassword(null);
        setTeamsUrl(null);
        setSlackUrl(null);
        router.refresh();
      } else {
        const data = await res.json();
        setMessage(`保存に失敗しました: ${data.error ?? 'unknown'}`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="📧 メール（SMTP）">
        <Toggle
          checked={channels.email}
          onChange={(v) => setChannels({ ...channels, email: v })}
          label="有効"
        />
        <Field label="ホスト">
          <input value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
            className="input" placeholder="smtp.example.com" />
        </Field>
        <Field label="ポート">
          <input type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
            className="input w-24" />
        </Field>
        <Field label="ユーザー名">
          <input value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} className="input" />
        </Field>
        <Field label="パスワード">
          <SecretField
            hasExisting={initial.smtp.hasPassword}
            value={smtpPassword}
            onChange={setSmtpPassword}
          />
        </Field>
        <Field label="差出人 (From)">
          <input value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })}
            className="input" placeholder="nudge@example.com" />
        </Field>
        <Toggle
          checked={smtp.secure}
          onChange={(v) => setSmtp({ ...smtp, secure: v })}
          label="TLS (secure)"
        />
      </Section>

      <Section title="💬 Microsoft Teams">
        <Toggle checked={channels.teams} onChange={(v) => setChannels({ ...channels, teams: v })} label="有効" />
        <Field label="Webhook URL">
          <SecretField
            hasExisting={initial.teams.hasWebhookUrl}
            value={teamsUrl}
            onChange={setTeamsUrl}
          />
        </Field>
      </Section>

      <Section title="💬 Slack">
        <Toggle checked={channels.slack} onChange={(v) => setChannels({ ...channels, slack: v })} label="有効" />
        <Field label="Webhook URL">
          <SecretField
            hasExisting={initial.slack.hasWebhookUrl}
            value={slackUrl}
            onChange={setSlackUrl}
          />
        </Field>
      </Section>

      <Section title="🔔 アプリ内通知">
        <Toggle checked={channels.in_app} onChange={(v) => setChannels({ ...channels, in_app: v })} label="有効" />
      </Section>

      <Section title="⏰ リマインド設定">
        <Field label="期限の何日前にリマインド">
          <input type="number" min={0} value={reminders.reminderBeforeDays}
            onChange={(e) => setReminders({ ...reminders, reminderBeforeDays: Number(e.target.value) })}
            className="input w-20" />
          <span className="ml-2 text-sm text-gray-600">日前</span>
        </Field>
        <Field label="期限超過後の再通知間隔">
          <input type="number" min={0} value={reminders.reNotifyIntervalDays}
            onChange={(e) => setReminders({ ...reminders, reNotifyIntervalDays: Number(e.target.value) })}
            className="input w-20" />
          <span className="ml-2 text-sm text-gray-600">日ごと</span>
        </Field>
        <Field label="期限超過後の最大再通知回数">
          <input type="number" min={0} value={reminders.reNotifyMaxCount}
            onChange={(e) => setReminders({ ...reminders, reNotifyMaxCount: Number(e.target.value) })}
            className="input w-20" />
          <span className="ml-2 text-sm text-gray-600">回</span>
        </Field>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded font-medium disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
        {message && <span className="text-sm text-gray-700">{message}</span>}
      </div>

      <style>{`
        .input {
          border: 1px solid #d1d5db;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 14px;
          background: white;
        }
      `}</style>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-gray-200 rounded-lg p-4 bg-white">
      <h2 className="text-sm font-semibold text-gray-800 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-gray-700 w-44">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function SecretField({
  hasExisting, value, onChange,
}: { hasExisting: boolean; value: string | null; onChange: (v: string | null) => void }) {
  if (value === null) {
    // showing masked or empty placeholder
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{hasExisting ? '●●●●●●' : '(未設定)'}</span>
        <button type="button" onClick={() => onChange('')} className="text-xs text-blue-600 underline">
          {hasExisting ? '変更' : '設定'}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)} className="input flex-1" />
      <button type="button" onClick={() => onChange(null)} className="text-xs text-gray-600 underline">
        キャンセル
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
corepack pnpm@9.12.0 exec tsc --noEmit
git add app/t/[code]/settings/ src/ui/components/settings-form.tsx \
        src/ui/components/sidebar.tsx app/t/[code]/layout.tsx
git commit -m "feat(ui): notification settings page + sidebar menu (tenant_admin only)"
```

---

## Phase 6: Verification

### Task 14: Full suite + manual verification

- [ ] **Step 1: Full suite**

```bash
corepack pnpm@9.12.0 run test:all
```
Expected: all pass

- [ ] **Step 2: Typecheck**

```bash
corepack pnpm@9.12.0 exec tsc --noEmit
```
Expected: clean

- [ ] **Step 3: Manual smoke test**

1. Start MailHog: `docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog`
2. Start web: `corepack pnpm@9.12.0 dev`
3. Start worker: `corepack pnpm@9.12.0 worker:dev`
4. Login as tenant_admin → navigate to `/t/<code>/settings/notification`
5. Configure SMTP: host=`localhost`, port=`1025`, from=`nudge@test.local`, enable email
6. Set reminder_before_days=`1`
7. Save
8. As another user, complete an assignment → verify email arrives at MailHog (`http://localhost:8025`) addressed to the requester (kind=completed)
9. Configure Teams or Slack Webhook (use a real test channel) → create a request → verify message appears

- [ ] **Step 4: Commit any fixes**

If smoke test surfaces issues, commit fixes with descriptive messages.

---

## Final Verification

- [ ] **Run full suite**

```bash
corepack pnpm@9.12.0 run test:all
corepack pnpm@9.12.0 exec tsc --noEmit
```

- [ ] **Merge feature branch**

```bash
git checkout main
git merge --no-ff feat/v09-notification-completion -m "Merge branch 'feat/v09-notification-completion': v0.9 Notification Completion + Settings UI"
```
