# v0.8 Notification Worker + Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate worker process (`pnpm worker`) that delivers notifications via SMTP and generates reminders (期限N日前 / 当日 / 超過後) on a 1-minute tick. Channel abstraction prepares for v0.9 Teams/Slack additions.

**Architecture:** New worker process consumes `notification` rows via SKIP LOCKED, dispatches through Channel implementations (InApp / Email). Scheduler reads tenant settings and generates idempotent reminder rows. SMTP password stored AES-256-GCM in a new `tenant_settings` table (deviates from spec — see Task 1).

**Tech Stack:** Node.js, tsx, PostgreSQL 17, nodemailer, vitest, @testcontainers/postgresql

---

## Spec Deviation Note

The spec proposed adding `smtp_*` and `reminder_*` columns to `tenant_notification_config`, but that table has PK `(tenant_id, channel)` — adding tenant-wide settings there would duplicate or scatter them across per-channel rows. **This plan uses a new `tenant_settings` table** with one row per tenant. Column names and semantics from the spec are preserved.

---

## Phase 1: Foundation (DB + crypto + emit extension)

### Task 1: Migration 030 — tenant_settings table

**Files:**
- Create: `migrations/030_tenant_settings.sql`
- Create: `tests/schema/tenant-settings.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 030: Tenant-wide settings: SMTP config + reminder cadence

CREATE TABLE tenant_settings (
  tenant_id                UUID PRIMARY KEY REFERENCES tenant(id),
  smtp_host                TEXT,
  smtp_port                INTEGER,
  smtp_user                TEXT,
  smtp_password_encrypted  TEXT,
  smtp_from                TEXT,
  smtp_secure              BOOLEAN NOT NULL DEFAULT false,
  reminder_before_days     INTEGER NOT NULL DEFAULT 1,
  re_notify_interval_days  INTEGER NOT NULL DEFAULT 3,
  re_notify_max_count      INTEGER NOT NULL DEFAULT 5,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
```

- [ ] **Step 2: Write the schema test**

```ts
// tests/schema/tenant-settings.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 030: tenant_settings', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('table exists with all expected columns', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name='tenant_settings' ORDER BY ordinal_position`,
    );
    const cols = rows.map((r) => r.column_name);
    expect(cols).toEqual([
      'tenant_id',
      'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password_encrypted',
      'smtp_from', 'smtp_secure',
      'reminder_before_days', 're_notify_interval_days', 're_notify_max_count',
      'updated_at',
    ]);
  });

  it('reminder defaults are 1 / 3 / 5', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name='tenant_settings'
          AND column_name IN ('reminder_before_days','re_notify_interval_days','re_notify_max_count')
        ORDER BY column_name`,
    );
    const defaults = rows.map((r) => r.column_default);
    expect(defaults).toEqual(['1', '3', '5']);
  });

  it('RLS policy exists', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT policyname FROM pg_policies WHERE tablename='tenant_settings'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run test**

Run: `corepack pnpm@9.12.0 vitest run tests/schema/tenant-settings.test.ts`
Expected: 3 passed

- [ ] **Step 4: Commit**

```bash
git add migrations/030_tenant_settings.sql tests/schema/tenant-settings.test.ts
git commit -m "feat(db): add tenant_settings table for SMTP + reminder config (migration 030)"
```

---

### Task 2: SMTP password crypto module

**Files:**
- Create: `src/notification/crypto.ts`
- Create: `tests/unit/notification/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/notification/crypto.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSmtpPassword, decryptSmtpPassword } from '../../../src/notification/crypto';

describe('SMTP password crypto', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('encrypts and decrypts round-trip', () => {
    const plain = 'super-secret-smtp-pass!';
    const encoded = encryptSmtpPassword(plain);
    expect(encoded).not.toBe(plain);
    expect(encoded.split('.').length).toBe(3); // iv.enc.tag base64
    const decoded = decryptSmtpPassword(encoded);
    expect(decoded).toBe(plain);
  });

  it('produces different ciphertexts for same input (random IV)', () => {
    const plain = 'same-password';
    const a = encryptSmtpPassword(plain);
    const b = encryptSmtpPassword(plain);
    expect(a).not.toBe(b);
    expect(decryptSmtpPassword(a)).toBe(plain);
    expect(decryptSmtpPassword(b)).toBe(plain);
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const plain = 'pw';
    const encoded = encryptSmtpPassword(plain);
    // Flip a char in the encrypted middle part
    const [iv, enc, tag] = encoded.split('.');
    const tampered = [iv, enc.slice(0, -1) + (enc.slice(-1) === 'A' ? 'B' : 'A'), tag].join('.');
    expect(() => decryptSmtpPassword(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/notification/crypto.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```ts
// src/notification/crypto.ts
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT = 'nudge-smtp-v1';
const ITERATIONS = 100_000;

function deriveKey(): Buffer {
  const password = process.env.IRON_SESSION_PASSWORD;
  if (!password) {
    throw new Error('IRON_SESSION_PASSWORD is required for SMTP encryption');
  }
  return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LEN, 'sha256');
}

export function encryptSmtpPassword(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, enc, tag].map((b) => b.toString('base64')).join('.');
}

export function decryptSmtpPassword(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 3) {
    throw new Error('invalid encrypted SMTP password format');
  }
  const [ivB64, encB64, tagB64] = parts;
  const decipher = createDecipheriv(ALG, deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}
```

- [ ] **Step 4: Run test to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/notification/crypto.test.ts`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/notification/crypto.ts tests/unit/notification/crypto.test.ts
git commit -m "feat(notification): AES-256-GCM SMTP password crypto"
```

---

### Task 3: Tenant settings types + emit.ts multi-channel extension

**Files:**
- Create: `src/notification/types.ts`
- Modify: `src/domain/notification/emit.ts`
- Modify: `tests/unit/domain/notification/emit.test.ts`

- [ ] **Step 1: Create types module**

```ts
// src/notification/types.ts
export type TenantSettings = {
  tenantId: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPasswordEncrypted: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
  reminderBeforeDays: number;
  reNotifyIntervalDays: number;
  reNotifyMaxCount: number;
};
```

- [ ] **Step 2: Add a failing test for multi-channel fan-out**

Append this test to `tests/unit/domain/notification/emit.test.ts`:

```ts
  it('fans out to channels listed in notification_rule (defaults to in_app+email)', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = randomUUID();
    await getPool().query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','t','active')`,
      [reqId, s.tenantId, s.users.admin],
    );
    await withTenant(getAppPool(), s.tenantId, async (client) => {
      await emitNotification(client, {
        tenantId: s.tenantId,
        recipientUserId: s.users.memberA,
        requestId: reqId,
        assignmentId: null,
        kind: 'created',
        payload: { title: 't' },
      });
    });
    const { rows } = await getPool().query(
      `SELECT channel FROM notification WHERE request_id=$1 ORDER BY channel`,
      [reqId],
    );
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'in_app']);
  });
```

- [ ] **Step 3: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/notification/emit.test.ts`
Expected: the new test FAILs (only `in_app` row created)

- [ ] **Step 4: Modify emit.ts to fan out**

Replace `src/domain/notification/emit.ts` content:

```ts
import type pg from 'pg';

export type NotificationKind =
  | 'created'
  | 'reminder_before'
  | 'due_today'
  | 're_notify'
  | 'completed';

export type EmitInput = {
  tenantId: string;
  recipientUserId: string;
  requestId: string | null;
  assignmentId: string | null;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

const DEFAULT_CHANNELS = ['in_app', 'email'];

async function getChannelsForKind(
  client: pg.PoolClient,
  tenantId: string,
  _kind: NotificationKind,
): Promise<string[]> {
  // Fan out to channels enabled in tenant_notification_config.
  // Falls back to ['in_app', 'email'] when no config rows exist.
  const { rows } = await client.query<{ channel: string }>(
    `SELECT channel FROM tenant_notification_config
      WHERE tenant_id = $1 AND enabled = true`,
    [tenantId],
  );
  if (rows.length === 0) return DEFAULT_CHANNELS;
  return rows.map((r) => r.channel);
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
        input.tenantId,
        input.requestId,
        input.assignmentId,
        input.recipientUserId,
        channel,
        input.kind,
        JSON.stringify(input.payload),
      ],
    );
  }
}
```

Note: This uses `tenant_notification_config` (per-channel enabled flag) instead of `notification_rule` because the existing schema fits this purpose. `notification_rule` retains its role for per-request override (future work).

- [ ] **Step 5: Run all emit tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/notification/emit.test.ts`
Expected: all passed (existing single-channel test now expects 2 channels — update if it asserts single row count; otherwise both pass)

If the previously-passing single-row test breaks, update it to assert `rows.length === 2` and check both channels exist.

- [ ] **Step 6: Run full suite to confirm no regressions**

Run: `corepack pnpm@9.12.0 run test:all`
Expected: existing v0.5/v0.6/v0.7 tests that emit notifications now produce 2 rows per kind. Update any tests that asserted exact row count.

Specifically, search for tests asserting notification counts:
```bash
grep -rn "notification" tests/ | grep -i "tohavelength\|count\|expect.*rows.*0\|expect.*rows.*1" | head -20
```

For each failing test, update the expected count to account for the new email row (typically `expect(rows).toHaveLength(N)` → `expect(rows).toHaveLength(N * 2)` if tenant has no config).

- [ ] **Step 7: Commit**

```bash
git add src/notification/types.ts src/domain/notification/emit.ts tests/unit/domain/notification/emit.test.ts
git add tests/  # any test count adjustments
git commit -m "feat(domain): emitNotification fans out to enabled channels (in_app+email default)"
```

---

## Phase 2: Channel abstraction

### Task 4: Channel interface + InAppChannel

**Files:**
- Create: `src/notification/channel.ts`
- Create: `src/notification/channels/in-app.ts`
- Create: `tests/unit/notification/channels/in-app.test.ts`

- [ ] **Step 1: Create the Channel interface**

```ts
// src/notification/channel.ts
import type { TenantSettings } from './types';

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
  send(ctx: NotificationContext, settings: TenantSettings): Promise<void>;
}

export class ChannelError extends Error {
  constructor(message: string, readonly code: 'config_missing' | 'transport_error') {
    super(message);
    this.name = 'ChannelError';
  }
}
```

- [ ] **Step 2: Create InAppChannel**

```ts
// src/notification/channels/in-app.ts
import type { Channel, NotificationContext } from '../channel';
import type { TenantSettings } from '../types';

export class InAppChannel implements Channel {
  readonly type = 'in_app' as const;
  async send(_ctx: NotificationContext, _settings: TenantSettings): Promise<void> {
    // No-op: the notification row itself is the in-app notification.
    // Sender will mark it sent.
  }
}
```

- [ ] **Step 3: Test**

```ts
// tests/unit/notification/channels/in-app.test.ts
import { describe, it, expect } from 'vitest';
import { InAppChannel } from '../../../../src/notification/channels/in-app';

describe('InAppChannel', () => {
  it('type is in_app', () => {
    expect(new InAppChannel().type).toBe('in_app');
  });

  it('send is a no-op (resolves without throwing)', async () => {
    const ch = new InAppChannel();
    await expect(
      ch.send(
        {
          notificationId: 'n1', tenantId: 't1', requestId: null, assignmentId: null,
          recipientUserId: 'u1', recipientEmail: 'a@b', recipientName: 'A',
          kind: 'created', payload: {},
        },
        {
          tenantId: 't1',
          smtpHost: null, smtpPort: null, smtpUser: null, smtpPasswordEncrypted: null,
          smtpFrom: null, smtpSecure: false,
          reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5,
        },
      ),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test + commit**

```bash
corepack pnpm@9.12.0 vitest run tests/unit/notification/channels/in-app.test.ts
git add src/notification/channel.ts src/notification/channels/in-app.ts tests/unit/notification/channels/in-app.test.ts
git commit -m "feat(notification): Channel interface + InAppChannel (no-op)"
```

---

### Task 5: Email render template

**Files:**
- Create: `src/notification/render-email.ts`
- Create: `tests/unit/notification/render-email.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/notification/render-email.test.ts
import { describe, it, expect } from 'vitest';
import { renderEmail } from '../../../src/notification/render-email';

describe('renderEmail', () => {
  const baseCtx = {
    notificationId: 'n1', tenantId: 't1', requestId: 'r1', assignmentId: null,
    recipientUserId: 'u1', recipientEmail: 'a@b', recipientName: '田中',
    payload: { title: 'テスト依頼' },
  };

  it.each([
    ['created', '届きました'],
    ['reminder_before', '近づいています'],
    ['due_today', '本日が期限'],
    ['re_notify', '期限超過'],
    ['completed', '完了'],
  ] as const)('subject for %s contains "%s"', (kind, marker) => {
    const out = renderEmail({ ...baseCtx, kind });
    expect(out.subject).toContain(marker);
    expect(out.subject).toContain('テスト依頼');
    expect(out.text).toContain('田中');
  });

  it('falls back to "依頼" when payload.title is missing', () => {
    const out = renderEmail({ ...baseCtx, kind: 'created', payload: {} });
    expect(out.subject).toContain('依頼');
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

- [ ] **Step 3: Implement**

```ts
// src/notification/render-email.ts
import type { NotificationContext } from './channel';

export function renderEmail(ctx: NotificationContext): { subject: string; text: string } {
  const title = (typeof ctx.payload.title === 'string' && ctx.payload.title) || '依頼';
  const greeting = `${ctx.recipientName} 様\n\n`;
  switch (ctx.kind) {
    case 'created':
      return {
        subject: `【Nudge】依頼が届きました: ${title}`,
        text: `${greeting}新しい依頼が届きました。\n\n依頼: ${title}\n\nご対応をお願いいたします。`,
      };
    case 'reminder_before':
      return {
        subject: `【Nudge】期限が近づいています: ${title}`,
        text: `${greeting}依頼の期限が近づいています。\n\n依頼: ${title}\n\nご対応をお願いいたします。`,
      };
    case 'due_today':
      return {
        subject: `【Nudge】本日が期限です: ${title}`,
        text: `${greeting}本日が期限の依頼があります。\n\n依頼: ${title}\n\n至急ご対応をお願いいたします。`,
      };
    case 're_notify':
      return {
        subject: `【Nudge】期限超過のご連絡: ${title}`,
        text: `${greeting}期限超過の依頼があります。\n\n依頼: ${title}\n\nご確認をお願いいたします。`,
      };
    case 'completed':
      return {
        subject: `【Nudge】依頼が完了されました: ${title}`,
        text: `${greeting}依頼が完了されました。\n\n依頼: ${title}`,
      };
  }
}
```

- [ ] **Step 4: Run test, commit**

```bash
git add src/notification/render-email.ts tests/unit/notification/render-email.test.ts
git commit -m "feat(notification): email subject/body templates for 5 notification kinds"
```

---

### Task 6: EmailChannel (nodemailer)

**Files:**
- Modify: `package.json` (add nodemailer)
- Create: `src/notification/channels/email.ts`
- Create: `tests/unit/notification/channels/email.test.ts`

- [ ] **Step 1: Install nodemailer**

```bash
corepack pnpm@9.12.0 add nodemailer
corepack pnpm@9.12.0 add -D @types/nodemailer
```

- [ ] **Step 2: Write failing test (uses jsonTransport for offline verification)**

```ts
// tests/unit/notification/channels/email.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { EmailChannel } from '../../../../src/notification/channels/email';
import { ChannelError } from '../../../../src/notification/channel';
import { encryptSmtpPassword } from '../../../../src/notification/crypto';
import type { TenantSettings } from '../../../../src/notification/types';
import type { NotificationContext } from '../../../../src/notification/channel';

const baseCtx: NotificationContext = {
  notificationId: 'n1', tenantId: 't1', requestId: 'r1', assignmentId: null,
  recipientUserId: 'u1', recipientEmail: 'to@example.com', recipientName: '田中',
  kind: 'created', payload: { title: 'テスト' },
};

const baseSettings: TenantSettings = {
  tenantId: 't1',
  smtpHost: 'smtp.example.com', smtpPort: 587, smtpUser: 'user',
  smtpPasswordEncrypted: null, smtpFrom: 'nudge@example.com', smtpSecure: false,
  reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5,
};

describe('EmailChannel', () => {
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('throws ChannelError when smtp_host is missing', async () => {
    const ch = new EmailChannel();
    await expect(
      ch.send(baseCtx, { ...baseSettings, smtpHost: null }),
    ).rejects.toBeInstanceOf(ChannelError);
  });

  it('throws ChannelError when smtp_from is missing', async () => {
    const ch = new EmailChannel();
    await expect(
      ch.send(baseCtx, { ...baseSettings, smtpFrom: null }),
    ).rejects.toBeInstanceOf(ChannelError);
  });

  it('sends mail via nodemailer with rendered subject/body', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const createTransport = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);

    const ch = new EmailChannel();
    await ch.send(baseCtx, baseSettings);

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
      }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'nudge@example.com',
        to: 'to@example.com',
        subject: expect.stringContaining('テスト'),
      }),
    );
  });

  it('decrypts SMTP password when configured', async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const createTransport = vi
      .spyOn(nodemailer, 'createTransport')
      .mockReturnValue({ sendMail } as never);

    const enc = encryptSmtpPassword('secret');
    const ch = new EmailChannel();
    await ch.send(baseCtx, { ...baseSettings, smtpPasswordEncrypted: enc });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: { user: 'user', pass: 'secret' },
      }),
    );
  });
});
```

- [ ] **Step 3: Run test to verify FAIL**

- [ ] **Step 4: Implement**

```ts
// src/notification/channels/email.ts
import nodemailer from 'nodemailer';
import type { Channel, NotificationContext } from '../channel';
import { ChannelError } from '../channel';
import type { TenantSettings } from '../types';
import { decryptSmtpPassword } from '../crypto';
import { renderEmail } from '../render-email';

export class EmailChannel implements Channel {
  readonly type = 'email' as const;

  async send(ctx: NotificationContext, settings: TenantSettings): Promise<void> {
    if (!settings.smtpHost) {
      throw new ChannelError('SMTP host not configured', 'config_missing');
    }
    if (!settings.smtpFrom) {
      throw new ChannelError('SMTP from address not configured', 'config_missing');
    }

    const auth = settings.smtpUser && settings.smtpPasswordEncrypted
      ? {
          user: settings.smtpUser,
          pass: decryptSmtpPassword(settings.smtpPasswordEncrypted),
        }
      : undefined;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort ?? 587,
      secure: settings.smtpSecure,
      auth,
    });

    const { subject, text } = renderEmail(ctx);
    try {
      await transporter.sendMail({
        from: settings.smtpFrom,
        to: ctx.recipientEmail,
        subject,
        text,
      });
    } catch (err) {
      throw new ChannelError(
        `SMTP send failed: ${(err as Error).message}`,
        'transport_error',
      );
    }
  }
}
```

- [ ] **Step 5: Run test, commit**

```bash
git add package.json pnpm-lock.yaml src/notification/channels/email.ts tests/unit/notification/channels/email.test.ts
git commit -m "feat(notification): EmailChannel via nodemailer with SMTP password decryption"
```

---

### Task 7: Channel registry

**Files:**
- Create: `src/notification/channel-registry.ts`
- Create: `tests/unit/notification/channel-registry.test.ts`

- [ ] **Step 1: Test**

```ts
// tests/unit/notification/channel-registry.test.ts
import { describe, it, expect } from 'vitest';
import { getChannel } from '../../../src/notification/channel-registry';

describe('channel-registry', () => {
  it('returns InAppChannel for in_app', () => {
    expect(getChannel('in_app')?.type).toBe('in_app');
  });

  it('returns EmailChannel for email', () => {
    expect(getChannel('email')?.type).toBe('email');
  });

  it('returns null for unknown type', () => {
    expect(getChannel('teams')).toBeNull();
    expect(getChannel('slack')).toBeNull();
    expect(getChannel('xyz')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement**

```ts
// src/notification/channel-registry.ts
import type { Channel } from './channel';
import { InAppChannel } from './channels/in-app';
import { EmailChannel } from './channels/email';

const channels: Record<string, Channel> = {
  in_app: new InAppChannel(),
  email: new EmailChannel(),
};

export function getChannel(type: string): Channel | null {
  return channels[type] ?? null;
}
```

- [ ] **Step 3: Run, commit**

```bash
git add src/notification/channel-registry.ts tests/unit/notification/channel-registry.test.ts
git commit -m "feat(notification): channel registry (in_app, email)"
```

---

## Phase 3: Worker logic

### Task 8: Sender — pending → channel.send → status

**Files:**
- Create: `src/worker/sender.ts`
- Create: `tests/unit/worker/sender.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/worker/sender.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../helpers/pg-container.js';
import { createDomainScenario } from '../../helpers/fixtures/domain-scenario.js';
import { runSender } from '../../../src/worker/sender';
import * as registry from '../../../src/notification/channel-registry';

async function seedRequest(s: Awaited<ReturnType<typeof createDomainScenario>>): Promise<string> {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','t','active')`,
    [id, s.tenantId, s.users.admin],
  );
  return id;
}

async function seedNotification(
  tenantId: string, requestId: string, recipientUserId: string,
  channel: string, kind = 'created',
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO notification
       (tenant_id, request_id, assignment_id, recipient_user_id,
        channel, kind, scheduled_at, status, payload_json)
     VALUES ($1, $2, NULL, $3, $4, $5, now(), 'pending', '{"title":"x"}'::jsonb)
     RETURNING id`,
    [tenantId, requestId, recipientUserId, channel, kind],
  );
  return rows[0].id;
}

describe('runSender', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('marks pending in_app notifications as sent', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'in_app');

    await runSender(getAppPool());

    const { rows } = await getPool().query(
      `SELECT status, sent_at FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].status).toBe('sent');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('marks email notification failed when SMTP not configured', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'email');

    await runSender(getAppPool());

    const { rows } = await getPool().query(
      `SELECT status, attempt_count, error_message FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].attempt_count).toBe(1);
    expect(rows[0].error_message).toMatch(/SMTP host not configured/);
  });

  it('skips already-sent notifications', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'in_app');
    await getPool().query(
      `UPDATE notification SET status='sent', sent_at=now() WHERE id=$1`, [nId],
    );

    await runSender(getAppPool());

    const { rows } = await getPool().query(
      `SELECT status FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].status).toBe('sent');
  });

  it('marks failed for unknown channel type', async () => {
    const s = await createDomainScenario(getPool());
    const reqId = await seedRequest(s);
    const nId = await seedNotification(s.tenantId, reqId, s.users.memberA, 'teams');

    await runSender(getAppPool());

    const { rows } = await getPool().query(
      `SELECT status, error_message FROM notification WHERE id=$1`, [nId],
    );
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error_message).toMatch(/unknown channel/i);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
// src/worker/sender.ts
import type pg from 'pg';
import { getChannel } from '../notification/channel-registry';
import type { TenantSettings } from '../notification/types';
import type { NotificationContext } from '../notification/channel';

const BATCH_SIZE = 100;

type PendingRow = {
  id: string;
  tenant_id: string;
  request_id: string | null;
  assignment_id: string | null;
  recipient_user_id: string;
  channel: string;
  kind: NotificationContext['kind'];
  payload_json: Record<string, unknown>;
};

type RecipientRow = {
  email: string;
  display_name: string;
};

const DEFAULT_SETTINGS = (tenantId: string): TenantSettings => ({
  tenantId,
  smtpHost: null, smtpPort: null, smtpUser: null, smtpPasswordEncrypted: null,
  smtpFrom: null, smtpSecure: false,
  reminderBeforeDays: 1, reNotifyIntervalDays: 3, reNotifyMaxCount: 5,
});

async function loadSettings(client: pg.PoolClient, tenantId: string): Promise<TenantSettings> {
  const { rows } = await client.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_password_encrypted,
            smtp_from, smtp_secure, reminder_before_days,
            re_notify_interval_days, re_notify_max_count
       FROM tenant_settings WHERE tenant_id = $1`,
    [tenantId],
  );
  if (rows.length === 0) return DEFAULT_SETTINGS(tenantId);
  const r = rows[0];
  return {
    tenantId,
    smtpHost: r.smtp_host,
    smtpPort: r.smtp_port,
    smtpUser: r.smtp_user,
    smtpPasswordEncrypted: r.smtp_password_encrypted,
    smtpFrom: r.smtp_from,
    smtpSecure: r.smtp_secure,
    reminderBeforeDays: r.reminder_before_days,
    reNotifyIntervalDays: r.re_notify_interval_days,
    reNotifyMaxCount: r.re_notify_max_count,
  };
}

async function loadRecipient(client: pg.PoolClient, userId: string): Promise<RecipientRow | null> {
  const { rows } = await client.query<RecipientRow>(
    `SELECT email, display_name FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function runSender(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Note: SKIP LOCKED requires the rows to be inside the same transaction
    // until processed, but channel.send() is async. Strategy: claim a batch
    // by UPDATE-ing status to 'pending' is no good — instead, fetch IDs
    // with FOR UPDATE SKIP LOCKED, then commit, then process each separately.
    // But that releases the locks. Pragmatic solution: process within the txn
    // and accept that long-running sends hold locks. For v0.8 batches are small.
    const { rows } = await client.query<PendingRow>(
      `SELECT id, tenant_id, request_id, assignment_id, recipient_user_id,
              channel, kind, payload_json
         FROM notification
        WHERE status='pending' AND scheduled_at <= now()
        ORDER BY scheduled_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      try {
        const channel = getChannel(row.channel);
        if (!channel) {
          throw new Error(`unknown channel: ${row.channel}`);
        }
        const recipient = await loadRecipient(client, row.recipient_user_id);
        if (!recipient) {
          throw new Error(`recipient not found: ${row.recipient_user_id}`);
        }
        const settings = await loadSettings(client, row.tenant_id);
        const ctx: NotificationContext = {
          notificationId: row.id,
          tenantId: row.tenant_id,
          requestId: row.request_id,
          assignmentId: row.assignment_id,
          recipientUserId: row.recipient_user_id,
          recipientEmail: recipient.email,
          recipientName: recipient.display_name,
          kind: row.kind,
          payload: row.payload_json,
        };
        await channel.send(ctx, settings);
        await client.query(
          `UPDATE notification SET status='sent', sent_at=now() WHERE id=$1`,
          [row.id],
        );
      } catch (err) {
        await client.query(
          `UPDATE notification
              SET status='failed',
                  attempt_count = attempt_count + 1,
                  error_message = $2
            WHERE id = $1`,
          [row.id, (err as Error).message],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run tests, commit**

```bash
git add src/worker/sender.ts tests/unit/worker/sender.test.ts
git commit -m "feat(worker): sender batch processes pending notifications via Channel"
```

---

### Task 9: Scheduler — generate reminder rows idempotently

**Files:**
- Create: `src/worker/scheduler.ts`
- Create: `tests/unit/worker/scheduler.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/worker/scheduler.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../../helpers/pg-container.js';
import { createDomainScenario } from '../../helpers/fixtures/domain-scenario.js';
import { runScheduler } from '../../../src/worker/scheduler';

async function setupRequestWithDue(
  s: Awaited<ReturnType<typeof createDomainScenario>>,
  daysFromNow: number,
): Promise<{ requestId: string; assignmentId: string }> {
  const requestId = randomUUID();
  const due = new Date(Date.now() + daysFromNow * 86400000);
  await getPool().query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status, due_at)
     VALUES ($1,$2,$3,'task','t','active',$4)`,
    [requestId, s.tenantId, s.users.admin, due.toISOString()],
  );
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1,$2,$3) RETURNING id`,
    [s.tenantId, requestId, s.users.memberA],
  );
  return { requestId, assignmentId: rows[0].id };
}

async function tenantSettings(
  tenantId: string,
  overrides: Partial<{ before: number; interval: number; max: number }> = {},
): Promise<void> {
  await getPool().query(
    `INSERT INTO tenant_settings(tenant_id, reminder_before_days, re_notify_interval_days, re_notify_max_count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id) DO UPDATE
        SET reminder_before_days = EXCLUDED.reminder_before_days,
            re_notify_interval_days = EXCLUDED.re_notify_interval_days,
            re_notify_max_count = EXCLUDED.re_notify_max_count`,
    [tenantId, overrides.before ?? 1, overrides.interval ?? 3, overrides.max ?? 5],
  );
}

describe('runScheduler', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('generates reminder_before notifications when due_at is N days away', async () => {
    const s = await createDomainScenario(getPool());
    await tenantSettings(s.tenantId, { before: 1 });
    const { requestId } = await setupRequestWithDue(s, 1); // due tomorrow

    await runScheduler(getAppPool());

    const { rows } = await getPool().query(
      `SELECT kind, channel FROM notification WHERE request_id=$1 AND kind='reminder_before' ORDER BY channel`,
      [requestId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind === 'reminder_before')).toBe(true);
  });

  it('is idempotent (running twice does not duplicate reminders)', async () => {
    const s = await createDomainScenario(getPool());
    await tenantSettings(s.tenantId, { before: 1 });
    const { requestId } = await setupRequestWithDue(s, 1);

    await runScheduler(getAppPool());
    const { rows: first } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification WHERE request_id=$1 AND kind='reminder_before'`,
      [requestId],
    );

    await runScheduler(getAppPool());
    const { rows: second } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification WHERE request_id=$1 AND kind='reminder_before'`,
      [requestId],
    );
    expect(second[0].n).toBe(first[0].n);
  });

  it('generates due_today when due_at is today', async () => {
    const s = await createDomainScenario(getPool());
    await tenantSettings(s.tenantId);
    const { requestId } = await setupRequestWithDue(s, 0); // due today

    await runScheduler(getAppPool());

    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification WHERE request_id=$1 AND kind='due_today'`,
      [requestId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('generates re_notify when overdue and interval has passed', async () => {
    const s = await createDomainScenario(getPool());
    await tenantSettings(s.tenantId, { interval: 0, max: 5 }); // every tick
    const { requestId } = await setupRequestWithDue(s, -2); // overdue

    await runScheduler(getAppPool());

    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification WHERE request_id=$1 AND kind='re_notify'`,
      [requestId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('respects re_notify_max_count', async () => {
    const s = await createDomainScenario(getPool());
    await tenantSettings(s.tenantId, { interval: 0, max: 2 });
    const { requestId, assignmentId } = await setupRequestWithDue(s, -2);

    // Pre-seed 2 re_notify rows already sent
    for (let i = 0; i < 2; i++) {
      await getPool().query(
        `INSERT INTO notification
           (tenant_id, request_id, assignment_id, recipient_user_id,
            channel, kind, scheduled_at, status, payload_json)
         VALUES ($1, $2, $3, $4, 'in_app', 're_notify',
                 now() - interval '1 hour', 'sent', '{}'::jsonb)`,
        [s.tenantId, requestId, assignmentId, s.users.memberA],
      );
    }

    await runScheduler(getAppPool());

    // Should NOT add a third re_notify because max_count=2 already reached
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM notification
        WHERE request_id=$1 AND kind='re_notify' AND assignment_id=$2`,
      [requestId, assignmentId],
    );
    expect(rows[0].n).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement**

```ts
// src/worker/scheduler.ts
import type pg from 'pg';

async function getEnabledChannels(
  client: pg.PoolClient, tenantId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ channel: string }>(
    `SELECT channel FROM tenant_notification_config
      WHERE tenant_id = $1 AND enabled = true`,
    [tenantId],
  );
  if (rows.length === 0) return ['in_app', 'email'];
  return rows.map((r) => r.channel);
}

async function generateReminderBefore(client: pg.PoolClient): Promise<void> {
  // For each tenant: find assignments where:
  //   request.due_at::date - reminder_before_days = today::date
  //   request.status = 'active'
  //   assignment.status IN ('unopened','opened')
  //   no existing notification with kind='reminder_before' for this assignment
  const { rows: tenants } = await client.query<{ tenant_id: string; days: number }>(
    `SELECT tenant_id, reminder_before_days AS days FROM tenant_settings`,
  );
  // Also include tenants without settings using defaults
  const { rows: allTenants } = await client.query<{ id: string }>(
    `SELECT id FROM tenant`,
  );
  const settingsMap = new Map(tenants.map((t) => [t.tenant_id, t.days]));

  for (const t of allTenants) {
    const days = settingsMap.get(t.id) ?? 1;
    const channels = await getEnabledChannels(client, t.id);

    const { rows: candidates } = await client.query<{
      assignment_id: string; request_id: string; user_id: string; title: string;
    }>(
      `SELECT a.id AS assignment_id, a.request_id, a.user_id, r.title
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.tenant_id = $1
          AND r.status = 'active'
          AND a.status IN ('unopened', 'opened')
          AND r.due_at IS NOT NULL
          AND (r.due_at::date - ($2::int))::date = (now())::date
          AND NOT EXISTS (
            SELECT 1 FROM notification n
             WHERE n.assignment_id = a.id AND n.kind = 'reminder_before'
          )`,
      [t.id, days],
    );

    for (const c of candidates) {
      for (const channel of channels) {
        await client.query(
          `INSERT INTO notification
             (tenant_id, request_id, assignment_id, recipient_user_id,
              channel, kind, scheduled_at, status, payload_json)
           VALUES ($1, $2, $3, $4, $5, 'reminder_before', now(), 'pending', $6::jsonb)`,
          [t.id, c.request_id, c.assignment_id, c.user_id, channel, JSON.stringify({ title: c.title })],
        );
      }
    }
  }
}

async function generateDueToday(client: pg.PoolClient): Promise<void> {
  const { rows: tenants } = await client.query<{ id: string }>(`SELECT id FROM tenant`);

  for (const t of tenants) {
    const channels = await getEnabledChannels(client, t.id);
    const { rows: candidates } = await client.query<{
      assignment_id: string; request_id: string; user_id: string; title: string;
    }>(
      `SELECT a.id AS assignment_id, a.request_id, a.user_id, r.title
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.tenant_id = $1
          AND r.status = 'active'
          AND a.status IN ('unopened', 'opened')
          AND r.due_at IS NOT NULL
          AND r.due_at::date = (now())::date
          AND NOT EXISTS (
            SELECT 1 FROM notification n
             WHERE n.assignment_id = a.id AND n.kind = 'due_today'
          )`,
      [t.id],
    );

    for (const c of candidates) {
      for (const channel of channels) {
        await client.query(
          `INSERT INTO notification
             (tenant_id, request_id, assignment_id, recipient_user_id,
              channel, kind, scheduled_at, status, payload_json)
           VALUES ($1, $2, $3, $4, $5, 'due_today', now(), 'pending', $6::jsonb)`,
          [t.id, c.request_id, c.assignment_id, c.user_id, channel, JSON.stringify({ title: c.title })],
        );
      }
    }
  }
}

async function generateReNotify(client: pg.PoolClient): Promise<void> {
  const { rows: settings } = await client.query<{
    tenant_id: string; interval_days: number; max_count: number;
  }>(
    `SELECT tenant_id, re_notify_interval_days AS interval_days,
            re_notify_max_count AS max_count
       FROM tenant_settings`,
  );
  const { rows: allTenants } = await client.query<{ id: string }>(`SELECT id FROM tenant`);
  const map = new Map(settings.map((s) => [s.tenant_id, s]));

  for (const t of allTenants) {
    const cfg = map.get(t.id) ?? { tenant_id: t.id, interval_days: 3, max_count: 5 };
    const channels = await getEnabledChannels(client, t.id);

    // Find overdue assignments with re_notify count < max_count and last re_notify
    // older than interval_days (or no re_notify yet)
    const { rows: candidates } = await client.query<{
      assignment_id: string; request_id: string; user_id: string; title: string;
      sent_count: number;
    }>(
      `SELECT a.id AS assignment_id, a.request_id, a.user_id, r.title,
              (SELECT COUNT(*)::int FROM notification n
                WHERE n.assignment_id = a.id
                  AND n.kind = 're_notify'
                  AND n.channel = 'in_app') AS sent_count
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.tenant_id = $1
          AND r.status = 'active'
          AND a.status IN ('unopened', 'opened')
          AND r.due_at IS NOT NULL
          AND r.due_at < now()
          AND (
            SELECT COUNT(*) FROM notification n2
             WHERE n2.assignment_id = a.id
               AND n2.kind = 're_notify'
               AND n2.channel = 'in_app'
          ) < $2
          AND NOT EXISTS (
            SELECT 1 FROM notification n3
             WHERE n3.assignment_id = a.id
               AND n3.kind = 're_notify'
               AND n3.channel = 'in_app'
               AND n3.created_at > now() - ($3 || ' days')::interval
          )`,
      [t.id, cfg.max_count, String(cfg.interval_days)],
    );

    for (const c of candidates) {
      for (const channel of channels) {
        await client.query(
          `INSERT INTO notification
             (tenant_id, request_id, assignment_id, recipient_user_id,
              channel, kind, scheduled_at, status, payload_json)
           VALUES ($1, $2, $3, $4, $5, 're_notify', now(), 'pending', $6::jsonb)`,
          [t.id, c.request_id, c.assignment_id, c.user_id, channel, JSON.stringify({ title: c.title })],
        );
      }
    }
  }
}

export async function runScheduler(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await generateReminderBefore(client);
    await generateDueToday(client);
    await generateReNotify(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```

Note: scheduler uses the admin pool implicitly because RLS requires `app.tenant_id` to be set per query, and we iterate across multiple tenants. For v0.8 the worker connects with a superuser-ish role (DATABASE_URL_ADMIN). If using app pool, replace each per-tenant query with `withTenant(...)`. Decision: **use admin pool** for scheduler (cross-tenant batch), keep sender on app pool with per-tenant withTenant inside. Adjust the test to use `getPool()` (admin) for scheduler.

- [ ] **Step 4: Update test and runner to use admin pool**

In `scheduler.test.ts`, change `runScheduler(getAppPool())` to `runScheduler(getPool())`. The runner in worker/main will pass admin pool.

- [ ] **Step 5: Run tests, commit**

```bash
git add src/worker/scheduler.ts tests/unit/worker/scheduler.test.ts
git commit -m "feat(worker): scheduler generates reminder_before/due_today/re_notify (idempotent)"
```

---

## Phase 4: Worker process

### Task 10: Worker main + package.json scripts

**Files:**
- Create: `src/worker/main.ts`
- Modify: `package.json`

- [ ] **Step 1: Update package.json scripts**

Add to `scripts`:
```json
"worker": "tsx src/worker/main.ts",
"worker:dev": "tsx watch src/worker/main.ts"
```

- [ ] **Step 2: Create main.ts**

```ts
// src/worker/main.ts
import 'dotenv/config';
import pg from 'pg';
import { runScheduler } from './scheduler';
import { runSender } from './sender';

const TICK_INTERVAL_MS = 60_000;

let stopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(adminPool: pg.Pool, appPool: pg.Pool): Promise<void> {
  try {
    await runScheduler(adminPool);
  } catch (err) {
    console.error('[worker] scheduler error:', (err as Error).message);
  }
  try {
    await runSender(appPool);
  } catch (err) {
    console.error('[worker] sender error:', (err as Error).message);
  }
}

async function main(): Promise<void> {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  const appUrl = process.env.DATABASE_URL_APP;
  if (!adminUrl || !appUrl) {
    console.error('DATABASE_URL_ADMIN and DATABASE_URL_APP are required');
    process.exit(1);
  }
  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 5 });
  const appPool = new pg.Pool({ connectionString: appUrl, max: 5 });

  process.on('SIGTERM', () => { stopRequested = true; });
  process.on('SIGINT', () => { stopRequested = true; });

  console.log('[worker] started, tick interval =', TICK_INTERVAL_MS, 'ms');
  while (!stopRequested) {
    const start = Date.now();
    await tick(adminPool, appPool);
    if (stopRequested) break;
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, TICK_INTERVAL_MS - elapsed);
    await sleep(remaining);
  }
  console.log('[worker] shutting down...');
  await adminPool.end();
  await appPool.end();
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Smoke-check by running once**

```bash
# Quick syntax check
corepack pnpm@9.12.0 exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/main.ts package.json
git commit -m "feat(worker): main entry with 1-minute tick loop and graceful shutdown"
```

---

### Task 11: Worker integration test (full tick cycle)

**Files:**
- Create: `tests/integration/worker-tick.test.ts`

- [ ] **Step 1: Write integration test**

```ts
// tests/integration/worker-tick.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getPool, getAppPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { runScheduler } from '../../src/worker/scheduler';
import { runSender } from '../../src/worker/sender';

describe('worker tick (scheduler + sender)', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(() => {
    process.env.IRON_SESSION_PASSWORD = 'test-password-32-chars-minimum-aaaa';
  });

  it('generates due_today reminder and delivers via in_app + email (mocked)', async () => {
    const s = await createDomainScenario(getPool());

    // Configure tenant: enable in_app + email + SMTP
    for (const channel of ['in_app', 'email']) {
      await getPool().query(
        `INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
         VALUES ($1, $2, true)
         ON CONFLICT (tenant_id, channel) DO UPDATE SET enabled = true`,
        [s.tenantId, channel],
      );
    }
    await getPool().query(
      `INSERT INTO tenant_settings(tenant_id, smtp_host, smtp_port, smtp_from, smtp_secure)
       VALUES ($1, 'smtp.example.com', 587, 'nudge@example.com', false)
       ON CONFLICT (tenant_id) DO UPDATE
          SET smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
              smtp_from = EXCLUDED.smtp_from, smtp_secure = EXCLUDED.smtp_secure`,
      [s.tenantId],
    );

    // Seed a request due today with one assignee
    const requestId = randomUUID();
    const today = new Date();
    await getPool().query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status, due_at)
       VALUES ($1, $2, $3, 'task', 'tick test', 'active', $4)`,
      [requestId, s.tenantId, s.users.admin, today.toISOString()],
    );
    await getPool().query(
      `INSERT INTO assignment(tenant_id, request_id, user_id) VALUES ($1, $2, $3)`,
      [s.tenantId, requestId, s.users.memberA],
    );

    // Mock nodemailer transport
    const sendMail = vi.fn().mockResolvedValue({ messageId: 'm1' });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);

    // Tick
    await runScheduler(getPool());     // admin pool for scheduler
    await runSender(getAppPool());     // app pool for sender

    // Verify: 2 due_today notifications (in_app + email), both sent
    const { rows: notifs } = await getPool().query(
      `SELECT channel, status FROM notification
        WHERE request_id=$1 AND kind='due_today' ORDER BY channel`,
      [requestId],
    );
    expect(notifs).toHaveLength(2);
    expect(notifs.map((r) => r.channel).sort()).toEqual(['email', 'in_app']);
    expect(notifs.every((r) => r.status === 'sent')).toBe(true);

    // Verify nodemailer was invoked once (for the email channel)
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@test',  // memberA's email in fixture
        subject: expect.stringContaining('本日が期限'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test**

Run: `corepack pnpm@9.12.0 vitest run tests/integration/worker-tick.test.ts`
Expected: pass

- [ ] **Step 3: Commit**

```bash
git add tests/integration/worker-tick.test.ts
git commit -m "test(integration): full worker tick generates and delivers due_today reminder"
```

---

## Phase 5: Verification

### Task 12: Final verification + manual setup docs

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

- [ ] **Step 3: Manual smoke test (optional but recommended)**

Start MailHog (Docker) for SMTP receive testing:
```bash
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

Configure tenant in psql:
```sql
INSERT INTO tenant_settings(tenant_id, smtp_host, smtp_port, smtp_from, smtp_secure)
VALUES ('<tenant_id>', 'localhost', 1025, 'nudge@test.local', false)
ON CONFLICT (tenant_id) DO UPDATE
   SET smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
       smtp_from = EXCLUDED.smtp_from;

INSERT INTO tenant_notification_config(tenant_id, channel, enabled)
VALUES ('<tenant_id>', 'in_app', true), ('<tenant_id>', 'email', true)
ON CONFLICT (tenant_id, channel) DO UPDATE SET enabled = true;
```

Run worker in one terminal:
```bash
corepack pnpm@9.12.0 worker:dev
```

Run web in another:
```bash
corepack pnpm@9.12.0 dev
```

Create a request via UI → within 1 minute, check MailHog at `http://localhost:8025` for the email.

- [ ] **Step 4: Commit any fixes**

If manual testing surfaces issues, commit fixes separately.

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
git merge --no-ff feat/v08-notification-worker -m "Merge branch 'feat/v08-notification-worker': v0.8 Notification Worker + Reminders"
```
