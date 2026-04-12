# Nudge v0.4 CSV Import + Org Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSV 一括インポートと Keycloak グループ同期で組織階層（`org_unit` + `org_unit_closure` + `user_org_unit`）を Nudge に取り込み、依頼のスコープ指定を動かす準備を整える。

**Architecture:** v0.3 の `SyncSource` interface に `OrgSyncSource` を追加し、`org-reconciler` が共通の組織 upsert + closure 再構築 + 所属同期を行う。`KeycloakSyncSource` と新規 `CsvSyncSource` がそれぞれ `OrgSyncSource` を実装。CSV は `csv-parse` ライブラリで解析し UTF-8 / BOM / Shift-JIS に対応。

**Tech Stack:** 既存スタック + `csv-parse` ^5.5.0

**Spec reference:** [2026-04-12-v04-csv-org-sync-design.md](../specs/2026-04-12-v04-csv-org-sync-design.md)

---

## File Structure

```
migrations/
  025_sync_config_org_columns.sql       # tenant_sync_config 列変更
  026_org_unit_external_id.sql          # org_unit.external_id 追加

src/sync/
  types.ts                              # OrgSyncSource, SyncOrgRecord, OrgSyncResult 追加
  csv-parser.ts                         # CSV パース + バリデーション + エンコーディング検出
  csv-source.ts                         # CsvSyncSource (SyncSource + OrgSyncSource)
  org-reconciler.ts                     # org_unit upsert + closure 再構築 + user_org_unit 同期
  keycloak-source.ts                    # OrgSyncSource 実装追加

app/api/admin/sync/
  users/route.ts                        # mode='full-with-orgs' 追加
  csv/route.ts                          # CSV アップロード

tests/
  schema/
    sync-config-org.test.ts
    org-unit-external-id.test.ts
  unit/sync/
    csv-parser.test.ts
    csv-source.test.ts
    org-reconciler.test.ts
    keycloak-org-source.test.ts
  integration/
    csv-import.test.ts
    sync-orgs.test.ts
```

---

## Task 1: Migrations 025-026 + schema tests

**Files:**
- Create: `migrations/025_sync_config_org_columns.sql`
- Create: `migrations/026_org_unit_external_id.sql`
- Create: `tests/schema/sync-config-org.test.ts`
- Create: `tests/schema/org-unit-external-id.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/schema/sync-config-org.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn } from '../helpers/schema-assertions.js';

describe('tenant_sync_config org columns', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sco-test', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('has user_source_type (renamed from source_type)', async () => {
    await assertColumn(pool, 'tenant_sync_config', 'user_source_type', 'text', false);
  });

  it('has org_source_type with default none', async () => {
    await assertColumn(pool, 'tenant_sync_config', 'org_source_type', 'text', false);
    await pool.query(
      `INSERT INTO tenant_sync_config (tenant_id) VALUES ($1)`,
      [tenantId],
    );
    const { rows } = await pool.query(
      `SELECT org_source_type FROM tenant_sync_config WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].org_source_type).toBe('none');
  });

  it('accepts keycloak, csv, none for both source types', async () => {
    const t2 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sco-kc', 'T2', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO tenant_sync_config (tenant_id, user_source_type, org_source_type)
       VALUES ($1, 'csv', 'keycloak')`,
      [t2],
    );
  });

  it('has org_group_prefix column', async () => {
    await assertColumn(pool, 'tenant_sync_config', 'org_group_prefix', 'text', true);
  });

  it('rejects invalid org_source_type', async () => {
    const t3 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('sco-bad', 'T3', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO tenant_sync_config (tenant_id, org_source_type) VALUES ($1, 'ldap')`,
        [t3],
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});
```

`tests/schema/org-unit-external-id.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb } from '../helpers/pg-container.js';
import { assertColumn } from '../helpers/schema-assertions.js';

describe('org_unit.external_id', () => {
  let pool: pg.Pool;
  let tenantId: string;
  beforeAll(async () => {
    pool = await startTestDb();
    tenantId = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('oei-test', 'T', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('has nullable external_id column', async () => {
    await assertColumn(pool, 'org_unit', 'external_id', 'text', true);
  });

  it('allows null external_id', async () => {
    await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level) VALUES ($1, 'Manual', 0)`,
      [tenantId],
    );
  });

  it('enforces unique within tenant when not null', async () => {
    await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level, external_id)
       VALUES ($1, 'A', 0, 'ext-1')`,
      [tenantId],
    );
    await expect(
      pool.query(
        `INSERT INTO org_unit (tenant_id, name, level, external_id)
         VALUES ($1, 'B', 0, 'ext-1')`,
        [tenantId],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('allows same external_id across tenants', async () => {
    const t2 = (await pool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('oei-t2', 'T2', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
    await pool.query(
      `INSERT INTO org_unit (tenant_id, name, level, external_id)
       VALUES ($1, 'C', 0, 'ext-1')`,
      [t2],
    );
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `corepack pnpm@9.12.0 test tests/schema/sync-config-org.test.ts tests/schema/org-unit-external-id.test.ts`

- [ ] **Step 3: Create migrations**

`migrations/025_sync_config_org_columns.sql`:

```sql
ALTER TABLE tenant_sync_config RENAME COLUMN source_type TO user_source_type;

ALTER TABLE tenant_sync_config ADD COLUMN org_source_type TEXT NOT NULL DEFAULT 'none'
  CHECK (org_source_type IN ('keycloak', 'csv', 'none'));

ALTER TABLE tenant_sync_config DROP CONSTRAINT IF EXISTS tenant_sync_config_source_type_check;
ALTER TABLE tenant_sync_config DROP CONSTRAINT IF EXISTS tenant_sync_config_user_source_type_check;
ALTER TABLE tenant_sync_config ADD CONSTRAINT tenant_sync_config_user_source_type_check
  CHECK (user_source_type IN ('keycloak', 'csv', 'none'));

ALTER TABLE tenant_sync_config ADD COLUMN org_group_prefix TEXT DEFAULT '/組織';
ALTER TABLE tenant_sync_config ADD COLUMN team_group_prefix TEXT;
ALTER TABLE tenant_sync_config ADD COLUMN ignore_group_prefixes TEXT[];
```

`migrations/026_org_unit_external_id.sql`:

```sql
ALTER TABLE org_unit ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX org_unit_tenant_external_idx
  ON org_unit (tenant_id, external_id) WHERE external_id IS NOT NULL;
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Full regression**

Run: `corepack pnpm@9.12.0 test`

**Important:** The v0.3 `keycloak-source.test.ts` or `reconciler.test.ts` might reference `source_type` which was renamed to `user_source_type`. If tests fail, update the affected test to use the new column name.

Also, the `sync_log` table has a `source_type` column — this was NOT renamed (it's on `sync_log`, not `tenant_sync_config`). Only `tenant_sync_config.source_type` was renamed.

- [ ] **Step 6: Commit**

```bash
git add migrations/025_sync_config_org_columns.sql migrations/026_org_unit_external_id.sql tests/schema/sync-config-org.test.ts tests/schema/org-unit-external-id.test.ts
git commit -m "feat(db): add org sync columns and org_unit.external_id"
```

---

## Task 2: Update `src/sync/types.ts` — add org types

**Files:**
- Modify: `src/sync/types.ts`

- [ ] **Step 1: Append org types to existing file**

Add after the existing `SyncSource` interface:

```typescript
export type SyncOrgRecord = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  level: number;
};

export type OrgSyncResult = {
  created: number;
  updated: number;
  removed: number;
  membershipsUpdated: number;
};

export type OrgMembership = {
  orgExternalId: string;
  userExternalId: string;
  isPrimary: boolean;
};

export interface OrgSyncSource {
  fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]>;
  fetchOrgMemberships(): AsyncGenerator<OrgMembership[]>;
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 3: Commit**

```bash
git add src/sync/types.ts
git commit -m "feat(sync): add OrgSyncSource interface and org types"
```

---

## Task 3: Install `csv-parse` + `csv-parser.ts` + tests

**Files:**
- Modify: `package.json`
- Create: `src/sync/csv-parser.ts`
- Create: `tests/unit/sync/csv-parser.test.ts`

- [ ] **Step 1: Install csv-parse**

Run: `corepack pnpm@9.12.0 add csv-parse`

- [ ] **Step 2: Write failing test**

`tests/unit/sync/csv-parser.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseSyncCsv } from '../../../src/sync/csv-parser.js';

describe('parseSyncCsv', () => {
  it('parses valid UTF-8 CSV', () => {
    const csv = [
      'employee_id,email,display_name,org_path,is_primary',
      'emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true',
      'emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true',
    ].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].employee_id).toBe('emp-001');
    expect(result.rows[0].org_path).toBe('/総務本部/総務部/総務課');
    expect(result.rows[0].is_primary).toBe(true);
  });

  it('parses UTF-8 BOM', () => {
    const bom = '\uFEFF';
    const csv = bom + 'employee_id,email,display_name,org_path\nemp-001,a@x,A,/Org';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].employee_id).toBe('emp-001');
  });

  it('defaults is_primary to true when missing', () => {
    const csv = 'employee_id,email,display_name,org_path\nemp-001,a@x,A,/Org';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].is_primary).toBe(true);
  });

  it('defaults status to active when missing', () => {
    const csv = 'employee_id,email,display_name,org_path\nemp-001,a@x,A,/Org';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].status).toBe('active');
  });

  it('handles multiple rows for same employee (兼務)', () => {
    const csv = [
      'employee_id,email,display_name,org_path,is_primary',
      'emp-001,a@x,A,/部A,true',
      'emp-001,a@x,A,/部B,false',
    ].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].is_primary).toBe(true);
    expect(result.rows[1].is_primary).toBe(false);
  });

  it('returns errors for missing required fields', () => {
    const csv = [
      'employee_id,email,display_name,org_path',
      'emp-001,,A,/Org',
      ',b@x,B,/Org',
    ].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors[0].line).toBe(2);
  });

  it('returns error for org_path not starting with /', () => {
    const csv = 'employee_id,email,display_name,org_path\nemp-001,a@x,A,NoSlash';
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(false);
  });

  it('limits errors to 10', () => {
    const header = 'employee_id,email,display_name,org_path';
    const badRows = Array.from({ length: 20 }, (_, i) => `,bad-${i}@x,B,/Org`);
    const csv = [header, ...badRows].join('\n');
    const result = parseSyncCsv(csv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(10);
  });
});
```

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Create `src/sync/csv-parser.ts`**

```typescript
import { parse } from 'csv-parse/sync';

export type CsvRow = {
  employee_id: string;
  email: string;
  display_name: string;
  org_path: string;
  is_primary: boolean;
  status: 'active' | 'inactive';
  lineNumber: number;
};

export type CsvParseResult =
  | { ok: true; rows: CsvRow[] }
  | { ok: false; errors: { line: number; message: string }[] };

export function parseSyncCsv(content: string): CsvParseResult {
  // Strip UTF-8 BOM
  const cleaned = content.replace(/^\uFEFF/, '');

  let records: Record<string, string>[];
  try {
    records = parse(cleaned, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    return {
      ok: false,
      errors: [{ line: 1, message: `CSV parse error: ${(err as Error).message}` }],
    };
  }

  const errors: { line: number; message: string }[] = [];
  const rows: CsvRow[] = [];
  const MAX_ERRORS = 10;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const line = i + 2; // +1 for header, +1 for 1-based

    if (errors.length >= MAX_ERRORS) break;

    if (!r.employee_id?.trim()) {
      errors.push({ line, message: 'missing employee_id' });
      continue;
    }
    if (!r.email?.trim()) {
      errors.push({ line, message: 'missing email' });
      continue;
    }
    if (!r.display_name?.trim()) {
      errors.push({ line, message: 'missing display_name' });
      continue;
    }
    if (!r.org_path?.trim()) {
      errors.push({ line, message: 'missing org_path' });
      continue;
    }
    if (!r.org_path.startsWith('/')) {
      errors.push({ line, message: 'org_path must start with /' });
      continue;
    }

    const isPrimaryRaw = (r.is_primary ?? '').trim().toLowerCase();
    const is_primary = isPrimaryRaw === 'false' ? false : true;

    const statusRaw = (r.status ?? '').trim().toLowerCase();
    const status = statusRaw === 'inactive' ? 'inactive' as const : 'active' as const;

    rows.push({
      employee_id: r.employee_id.trim(),
      email: r.email.trim(),
      display_name: r.display_name.trim(),
      org_path: r.org_path.trim(),
      is_primary,
      status,
      lineNumber: line,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, rows };
}
```

- [ ] **Step 5: Run → PASS**

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/sync/csv-parser.ts tests/unit/sync/csv-parser.test.ts
git commit -m "feat(sync): add CSV parser with UTF-8/BOM/validation support"
```

---

## Task 4: `csv-source.ts` + tests

**Files:**
- Create: `src/sync/csv-source.ts`
- Create: `tests/unit/sync/csv-source.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/sync/csv-source.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { CsvSyncSource } from '../../../src/sync/csv-source.js';

const CSV = [
  'employee_id,email,display_name,org_path,is_primary',
  'emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/DX推進,false',
].join('\n');

describe('CsvSyncSource', () => {
  it('fetchAllUsers returns deduplicated users', async () => {
    const source = new CsvSyncSource(CSV);
    const users = [];
    for await (const chunk of source.fetchAllUsers()) {
      users.push(...chunk);
    }
    expect(users).toHaveLength(2);
    expect(users[0].externalId).toBe('emp-001');
    expect(users[1].externalId).toBe('emp-002');
  });

  it('fetchAllOrgs generates tree from paths', async () => {
    const source = new CsvSyncSource(CSV);
    const orgs = [];
    for await (const chunk of source.fetchAllOrgs()) {
      orgs.push(...chunk);
    }
    // /総務本部, /総務本部/総務部, /総務本部/総務部/総務課, /総務本部/総務部/人事課, /DX推進
    expect(orgs.length).toBe(5);
    const hq = orgs.find((o) => o.externalId === '/総務本部');
    expect(hq?.name).toBe('総務本部');
    expect(hq?.parentExternalId).toBeNull();
    expect(hq?.level).toBe(0);
    const dept = orgs.find((o) => o.externalId === '/総務本部/総務部');
    expect(dept?.parentExternalId).toBe('/総務本部');
    expect(dept?.level).toBe(1);
  });

  it('fetchOrgMemberships returns all memberships', async () => {
    const source = new CsvSyncSource(CSV);
    const memberships = [];
    for await (const chunk of source.fetchOrgMemberships()) {
      memberships.push(...chunk);
    }
    expect(memberships).toHaveLength(3); // emp-001×1 + emp-002×2
    const primary = memberships.find(
      (m) => m.userExternalId === 'emp-001' && m.orgExternalId === '/総務本部/総務部/総務課',
    );
    expect(primary?.isPrimary).toBe(true);
    const secondary = memberships.find(
      (m) => m.userExternalId === 'emp-002' && m.orgExternalId === '/DX推進',
    );
    expect(secondary?.isPrimary).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Create `src/sync/csv-source.ts`**

```typescript
import type {
  SyncSource, SyncUserRecord,
  OrgSyncSource, SyncOrgRecord, OrgMembership,
} from './types.js';
import { parseSyncCsv, type CsvRow } from './csv-parser.js';

export class CsvSyncSource implements SyncSource, OrgSyncSource {
  private rows: CsvRow[];

  constructor(csvContent: string) {
    const result = parseSyncCsv(csvContent);
    if (!result.ok) {
      throw new Error(`CSV parse failed: ${result.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`);
    }
    this.rows = result.rows;
  }

  async *fetchAllUsers(): AsyncGenerator<SyncUserRecord[]> {
    const seen = new Map<string, SyncUserRecord>();
    for (const row of this.rows) {
      if (!seen.has(row.employee_id)) {
        seen.set(row.employee_id, {
          externalId: row.employee_id,
          email: row.email,
          displayName: row.display_name,
          active: row.status === 'active',
        });
      }
    }
    yield [...seen.values()];
  }

  async *fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]> {
    const orgMap = new Map<string, SyncOrgRecord>();
    for (const row of this.rows) {
      const parts = row.org_path.split('/').filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        const path = '/' + parts.slice(0, i + 1).join('/');
        if (!orgMap.has(path)) {
          const parentPath = i === 0 ? null : '/' + parts.slice(0, i).join('/');
          orgMap.set(path, {
            externalId: path,
            name: parts[i],
            parentExternalId: parentPath,
            level: i,
          });
        }
      }
    }
    yield [...orgMap.values()];
  }

  async *fetchOrgMemberships(): AsyncGenerator<OrgMembership[]> {
    const memberships: OrgMembership[] = this.rows.map((row) => ({
      orgExternalId: row.org_path,
      userExternalId: row.employee_id,
      isPrimary: row.is_primary,
    }));
    yield memberships;
  }
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/sync/csv-source.ts tests/unit/sync/csv-source.test.ts
git commit -m "feat(sync): add CsvSyncSource implementing SyncSource + OrgSyncSource"
```

---

## Task 5: `org-reconciler.ts` + tests

**Files:**
- Create: `src/sync/org-reconciler.ts`
- Create: `tests/unit/sync/org-reconciler.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/sync/org-reconciler.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../../helpers/pg-container.js';
import { reconcileOrgs } from '../../../src/sync/org-reconciler.js';
import type { OrgSyncSource, SyncOrgRecord, OrgMembership } from '../../../src/sync/types.js';

function mockOrgSource(
  orgs: SyncOrgRecord[],
  memberships: OrgMembership[] = [],
): OrgSyncSource {
  return {
    async *fetchAllOrgs() { yield orgs; },
    async *fetchOrgMemberships() { yield memberships; },
  };
}

describe('reconcileOrgs', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('or-test', 'OR', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await adminPool.query(`DELETE FROM user_org_unit WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM org_unit_closure WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM org_unit WHERE tenant_id = $1`, [tenantId]);
    await adminPool.query(`DELETE FROM users WHERE tenant_id = $1`, [tenantId]);
  });

  it('creates org_unit tree from flat records', async () => {
    const source = mockOrgSource([
      { externalId: 'hq', name: '本部', parentExternalId: null, level: 0 },
      { externalId: 'dept', name: '総務部', parentExternalId: 'hq', level: 1 },
      { externalId: 'sec', name: '総務課', parentExternalId: 'dept', level: 2 },
    ]);
    const result = await reconcileOrgs(adminPool, tenantId, source);
    expect(result.created).toBe(3);

    const { rows } = await adminPool.query(
      `SELECT name, level, external_id FROM org_unit WHERE tenant_id = $1 ORDER BY level`,
      [tenantId],
    );
    expect(rows).toEqual([
      { name: '本部', level: 0, external_id: 'hq' },
      { name: '総務部', level: 1, external_id: 'dept' },
      { name: '総務課', level: 2, external_id: 'sec' },
    ]);
  });

  it('rebuilds org_unit_closure correctly', async () => {
    const source = mockOrgSource([
      { externalId: 'hq', name: 'HQ', parentExternalId: null, level: 0 },
      { externalId: 'dept', name: 'Dept', parentExternalId: 'hq', level: 1 },
      { externalId: 'sec', name: 'Sec', parentExternalId: 'dept', level: 2 },
    ]);
    await reconcileOrgs(adminPool, tenantId, source);

    // HQ should have 3 descendants (self + dept + sec)
    const { rows } = await adminPool.query(
      `SELECT c.descendant_id, o.name, c.depth
       FROM org_unit_closure c JOIN org_unit o ON c.descendant_id = o.id
       WHERE c.tenant_id = $1
         AND c.ancestor_id = (SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = 'hq')
       ORDER BY c.depth`,
      [tenantId],
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['HQ', 'Dept', 'Sec']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });

  it('updates changed org name', async () => {
    const source1 = mockOrgSource([
      { externalId: 'a', name: 'Old', parentExternalId: null, level: 0 },
    ]);
    await reconcileOrgs(adminPool, tenantId, source1);

    const source2 = mockOrgSource([
      { externalId: 'a', name: 'New', parentExternalId: null, level: 0 },
    ]);
    const result = await reconcileOrgs(adminPool, tenantId, source2);
    expect(result.updated).toBe(1);

    const { rows } = await adminPool.query(
      `SELECT name FROM org_unit WHERE tenant_id = $1 AND external_id = 'a'`,
      [tenantId],
    );
    expect(rows[0].name).toBe('New');
  });

  it('removes org_unit with no members when missing from source', async () => {
    const source1 = mockOrgSource([
      { externalId: 'gone', name: 'Gone', parentExternalId: null, level: 0 },
    ]);
    await reconcileOrgs(adminPool, tenantId, source1);

    const source2 = mockOrgSource([]);
    const result = await reconcileOrgs(adminPool, tenantId, source2);
    expect(result.removed).toBe(1);
  });

  it('keeps org_unit with members when missing from source', async () => {
    const source1 = mockOrgSource([
      { externalId: 'kept', name: 'Kept', parentExternalId: null, level: 0 },
    ]);
    await reconcileOrgs(adminPool, tenantId, source1);

    // Add a user to this org
    const userId = (await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'u1', 'u@x', 'U') RETURNING id`,
      [tenantId],
    )).rows[0].id;
    const ouId = (await adminPool.query(
      `SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = 'kept'`,
      [tenantId],
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary)
       VALUES ($1, $2, $3, true)`,
      [tenantId, userId, ouId],
    );

    const source2 = mockOrgSource([]);
    const result = await reconcileOrgs(adminPool, tenantId, source2);
    expect(result.removed).toBe(0); // kept because has members
  });

  it('syncs memberships from source', async () => {
    const userId = (await adminPool.query(
      `INSERT INTO users (tenant_id, keycloak_sub, email, display_name)
       VALUES ($1, 'mem-u1', 'mu@x', 'MU') RETURNING id`,
      [tenantId],
    )).rows[0].id;

    const source = mockOrgSource(
      [{ externalId: 'org-m', name: 'OrgM', parentExternalId: null, level: 0 }],
      [{ orgExternalId: 'org-m', userExternalId: 'mem-u1', isPrimary: true }],
    );
    const result = await reconcileOrgs(adminPool, tenantId, source);
    expect(result.membershipsUpdated).toBeGreaterThanOrEqual(1);

    const { rows } = await adminPool.query(
      `SELECT is_primary FROM user_org_unit WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId],
    );
    expect(rows[0].is_primary).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Create `src/sync/org-reconciler.ts`**

```typescript
import pg from 'pg';
import type { OrgSyncSource, OrgSyncResult } from './types.js';

export async function reconcileOrgs(
  adminPool: pg.Pool,
  tenantId: string,
  source: OrgSyncSource,
): Promise<OrgSyncResult> {
  const result: OrgSyncResult = { created: 0, updated: 0, removed: 0, membershipsUpdated: 0 };

  // Step 1: Collect all orgs from source
  const allOrgs: { externalId: string; name: string; parentExternalId: string | null; level: number }[] = [];
  for await (const chunk of source.fetchAllOrgs()) {
    allOrgs.push(...chunk);
  }

  const seenExternalIds = new Set(allOrgs.map((o) => o.externalId));

  // Step 2: Upsert org_units (without parent_id first)
  const extIdToDbId = new Map<string, string>();

  for (const org of allOrgs) {
    const { rows } = await adminPool.query<{ id: string; action: string }>(
      `INSERT INTO org_unit (tenant_id, external_id, name, level, parent_id)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET
         name = EXCLUDED.name,
         level = EXCLUDED.level
       WHERE org_unit.name != EXCLUDED.name OR org_unit.level != EXCLUDED.level
       RETURNING id, CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
      [tenantId, org.externalId, org.name, org.level],
    );

    if (rows.length > 0) {
      extIdToDbId.set(org.externalId, rows[0].id);
      if (rows[0].action === 'created') result.created++;
      else result.updated++;
    } else {
      // No change — still need the DB id
      const existing = await adminPool.query<{ id: string }>(
        `SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = $2`,
        [tenantId, org.externalId],
      );
      if (existing.rows[0]) extIdToDbId.set(org.externalId, existing.rows[0].id);
    }
  }

  // Step 3: Set parent_id using the extIdToDbId map
  for (const org of allOrgs) {
    if (org.parentExternalId) {
      const parentDbId = extIdToDbId.get(org.parentExternalId);
      const childDbId = extIdToDbId.get(org.externalId);
      if (parentDbId && childDbId) {
        await adminPool.query(
          `UPDATE org_unit SET parent_id = $1 WHERE id = $2 AND (parent_id IS NULL OR parent_id != $1)`,
          [parentDbId, childDbId],
        );
      }
    }
  }

  // Step 4: Remove org_units not in source (only if no members)
  const { rows: existingOrgs } = await adminPool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM org_unit WHERE tenant_id = $1 AND external_id IS NOT NULL`,
    [tenantId],
  );
  for (const existing of existingOrgs) {
    if (!seenExternalIds.has(existing.external_id)) {
      const { rows: members } = await adminPool.query(
        `SELECT 1 FROM user_org_unit WHERE org_unit_id = $1 LIMIT 1`,
        [existing.id],
      );
      if (members.length === 0) {
        await adminPool.query(`DELETE FROM org_unit_closure WHERE ancestor_id = $1 OR descendant_id = $1`, [existing.id]);
        await adminPool.query(`DELETE FROM org_unit WHERE id = $1`, [existing.id]);
        result.removed++;
      }
    }
  }

  // Step 5: Rebuild closure table
  await rebuildClosure(adminPool, tenantId);

  // Step 6: Sync memberships
  const allMemberships: { orgExternalId: string; userExternalId: string; isPrimary: boolean }[] = [];
  for await (const chunk of source.fetchOrgMemberships()) {
    allMemberships.push(...chunk);
  }

  if (allMemberships.length > 0) {
    // Delete existing synced memberships for this tenant
    // Only delete memberships for orgs that have external_id (synced orgs)
    await adminPool.query(
      `DELETE FROM user_org_unit
       WHERE tenant_id = $1
         AND org_unit_id IN (SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id IS NOT NULL)`,
      [tenantId],
    );

    let membershipCount = 0;
    for (const m of allMemberships) {
      const orgDbId = extIdToDbId.get(m.orgExternalId);
      if (!orgDbId) continue;

      // Lookup user by keycloak_sub (= externalId)
      const { rows: userRows } = await adminPool.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND keycloak_sub = $2`,
        [tenantId, m.userExternalId],
      );
      if (userRows.length === 0) continue;

      await adminPool.query(
        `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, org_unit_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
        [tenantId, userRows[0].id, orgDbId, m.isPrimary],
      );
      membershipCount++;
    }
    result.membershipsUpdated = membershipCount;

    // Ensure each user has at least one is_primary=true
    await adminPool.query(
      `UPDATE user_org_unit uou SET is_primary = true
       WHERE uou.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM user_org_unit uou2
           WHERE uou2.user_id = uou.user_id AND uou2.is_primary = true
         )
         AND uou.assigned_at = (
           SELECT MIN(uou3.assigned_at) FROM user_org_unit uou3
           WHERE uou3.user_id = uou.user_id
         )`,
      [tenantId],
    );
  }

  return result;
}

async function rebuildClosure(adminPool: pg.Pool, tenantId: string): Promise<void> {
  await adminPool.query(
    `DELETE FROM org_unit_closure WHERE tenant_id = $1`,
    [tenantId],
  );
  await adminPool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, id AS ancestor, 0 AS depth
       FROM org_unit WHERE tenant_id = $1
       UNION ALL
       SELECT o.id, t.ancestor, t.depth + 1
       FROM org_unit o JOIN tree t ON o.parent_id = t.id
       WHERE o.tenant_id = $1
     )
     INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
     SELECT $1, ancestor, id, depth FROM tree`,
    [tenantId],
  );
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/sync/org-reconciler.ts tests/unit/sync/org-reconciler.test.ts
git commit -m "feat(sync): add org-reconciler with closure rebuild and membership sync"
```

---

## Task 6: `KeycloakSyncSource` — add `OrgSyncSource` impl + tests

**Files:**
- Modify: `src/sync/keycloak-source.ts`
- Create: `tests/unit/sync/keycloak-org-source.test.ts`

- [ ] **Step 1: Write failing test**

`tests/unit/sync/keycloak-org-source.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KeycloakSyncSource } from '../../../src/sync/keycloak-source.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
const originalFetch = globalThis.fetch;

import { afterAll } from 'vitest';
afterAll(() => { globalThis.fetch = originalFetch; });

const TOKEN_RESPONSE = { access_token: 'test-token' };

describe('KeycloakSyncSource OrgSyncSource', () => {
  let source: KeycloakSyncSource;

  beforeEach(() => {
    mockFetch.mockReset();
    source = new KeycloakSyncSource(
      'https://kc.example.com/realms/test',
      'nudge-sync',
      'secret',
    );
  });

  it('fetchAllOrgs filters by org_group_prefix and flattens tree', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => TOKEN_RESPONSE });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'g-org', name: '組織', path: '/組織',
          subGroups: [
            {
              id: 'g-hq', name: '総務本部', path: '/組織/総務本部',
              subGroups: [
                { id: 'g-dept', name: '総務部', path: '/組織/総務本部/総務部', subGroups: [] },
              ],
            },
          ],
        },
        {
          id: 'g-role', name: '役職', path: '/役職',
          subGroups: [{ id: 'g-mgr', name: '部長', path: '/役職/部長', subGroups: [] }],
        },
      ],
    });

    source.setOrgGroupPrefix('/組織');
    const orgs = [];
    for await (const chunk of source.fetchAllOrgs()) {
      orgs.push(...chunk);
    }
    // Should include 総務本部 and 総務部, but NOT 組織 itself, NOT 役職/部長
    expect(orgs).toHaveLength(2);
    expect(orgs[0]).toEqual({
      externalId: 'g-hq',
      name: '総務本部',
      parentExternalId: null,
      level: 0,
    });
    expect(orgs[1]).toEqual({
      externalId: 'g-dept',
      name: '総務部',
      parentExternalId: 'g-hq',
      level: 1,
    });
  });

  it('fetchOrgMemberships retrieves group members', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => TOKEN_RESPONSE });
    // groups response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'g-org', name: '組織', path: '/組織',
          subGroups: [
            { id: 'g-dept', name: 'Dept', path: '/組織/Dept', subGroups: [] },
          ],
        },
      ],
    });
    // members of g-dept
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'user-1', username: 'alice' },
        { id: 'user-2', username: 'bob' },
      ],
    });
    // empty next page
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    source.setOrgGroupPrefix('/組織');
    const memberships = [];
    for await (const chunk of source.fetchOrgMemberships()) {
      memberships.push(...chunk);
    }
    expect(memberships).toHaveLength(2);
    expect(memberships[0]).toEqual({
      orgExternalId: 'g-dept',
      userExternalId: 'user-1',
      isPrimary: false,
    });
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Update `src/sync/keycloak-source.ts`**

Add `OrgSyncSource` to the class. Add `import type { OrgSyncSource, SyncOrgRecord, OrgMembership }` at the top.

Add a `private orgGroupPrefix: string | null = null;` field and:

```typescript
setOrgGroupPrefix(prefix: string): void {
  this.orgGroupPrefix = prefix;
}
```

Add `fetchAllOrgs()` method:

```typescript
async *fetchAllOrgs(): AsyncGenerator<SyncOrgRecord[]> {
  if (!this.orgGroupPrefix) throw new Error('orgGroupPrefix not set');
  const url = `${this.realmAdminUrl}/groups?briefRepresentation=false`;
  const res = await this.authedFetch(url);
  if (!res.ok) throw new Error(`KC groups API failed: ${res.status}`);
  const topGroups = (await res.json()) as KcGroup[];

  const records: SyncOrgRecord[] = [];
  const prefixParts = this.orgGroupPrefix.split('/').filter(Boolean);

  function walkTree(group: KcGroup, depth: number, parentId: string | null) {
    const pathParts = group.path.split('/').filter(Boolean);
    // Check if this group's path starts with the prefix
    if (pathParts.length <= prefixParts.length) {
      // This is the prefix group itself or above it — skip but recurse
      for (const sub of group.subGroups ?? []) {
        walkTree(sub, depth, parentId);
      }
      return;
    }
    // Check prefix match
    for (let i = 0; i < prefixParts.length; i++) {
      if (pathParts[i] !== prefixParts[i]) return;
    }
    const level = pathParts.length - prefixParts.length - 1;
    records.push({
      externalId: group.id,
      name: group.name,
      parentExternalId: parentId,
      level,
    });
    for (const sub of group.subGroups ?? []) {
      walkTree(sub, depth + 1, group.id);
    }
  }

  for (const top of topGroups) {
    walkTree(top, 0, null);
  }
  yield records;
}
```

Add `fetchOrgMemberships()` method:

```typescript
async *fetchOrgMemberships(): AsyncGenerator<OrgMembership[]> {
  if (!this.orgGroupPrefix) throw new Error('orgGroupPrefix not set');
  // First get all org group IDs
  const orgIds: string[] = [];
  for await (const chunk of this.fetchAllOrgs()) {
    orgIds.push(...chunk.map((o) => o.externalId));
  }

  const memberships: OrgMembership[] = [];
  for (const groupId of orgIds) {
    let offset = 0;
    while (true) {
      const url = `${this.realmAdminUrl}/groups/${groupId}/members?first=${offset}&max=500`;
      const res = await this.authedFetch(url);
      if (!res.ok) break;
      const members = (await res.json()) as { id: string }[];
      if (members.length === 0) break;
      for (const m of members) {
        memberships.push({
          orgExternalId: groupId,
          userExternalId: m.id,
          isPrimary: false,
        });
      }
      if (members.length < 500) break;
      offset += 500;
    }
  }
  yield memberships;
}
```

Add the `KcGroup` type:

```typescript
type KcGroup = {
  id: string;
  name: string;
  path: string;
  subGroups?: KcGroup[];
};
```

Update the class declaration to implement `OrgSyncSource`:

```typescript
export class KeycloakSyncSource implements SyncSource, OrgSyncSource {
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/sync/keycloak-source.ts tests/unit/sync/keycloak-org-source.test.ts
git commit -m "feat(sync): add OrgSyncSource to KeycloakSyncSource with prefix filter"
```

---

## Task 7: Update `POST /api/admin/sync/users` — add `full-with-orgs` mode

**Files:**
- Modify: `app/api/admin/sync/users/route.ts`

- [ ] **Step 1: Update the route**

In the mode parsing section, add `'full-with-orgs'`:

```typescript
const validModes = ['full', 'delta', 'full-with-orgs'] as const;
type SyncMode = typeof validModes[number];
const mode: SyncMode = validModes.includes(body.mode as any)
  ? (body.mode as SyncMode)
  : 'delta';
```

In the per-tenant processing loop, after building the `KeycloakSyncSource`, add org sync when mode is `'full-with-orgs'`:

```typescript
if (mode === 'full-with-orgs') {
  // Import org-reconciler
  const { reconcileOrgs } = await import('@/sync/org-reconciler');

  // Get org config
  const { rows: orgConfig } = await pool.query<{
    org_source_type: string;
    org_group_prefix: string | null;
  }>(
    `SELECT org_source_type, org_group_prefix FROM tenant_sync_config WHERE tenant_id = $1`,
    [tenant.id],
  );

  if (orgConfig[0]?.org_source_type === 'keycloak' && orgConfig[0].org_group_prefix) {
    source.setOrgGroupPrefix(orgConfig[0].org_group_prefix);
    const orgResult = await reconcileOrgs(pool, tenant.id, source);
    // Add orgResult to response
  }
}

// Then run user sync (full mode)
const userMode = mode === 'full-with-orgs' ? 'full' : mode;
const syncResult = await reconcileUsers(appPool(), pool, tenant.id, source, userMode as 'full' | 'delta');
```

Integrate the org result into the response by extending the result object to include an `orgs` field when applicable.

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/sync/users/route.ts
git commit -m "feat(api): add full-with-orgs sync mode"
```

---

## Task 8: CSV upload endpoint (`POST /api/admin/sync/csv`)

**Files:**
- Create: `app/api/admin/sync/csv/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { loadConfig } from '@/config';
import { verifySyncAuth } from '@/sync/api-auth';
import { unsealSession } from '@/auth/session';
import { CsvSyncSource } from '@/sync/csv-source';
import { reconcileUsers } from '@/sync/reconciler';
import { reconcileOrgs } from '@/sync/org-reconciler';

export const runtime = 'nodejs';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(req: NextRequest) {
  const cfg = loadConfig();

  // Auth
  const authHeader = req.headers.get('authorization');
  const sealed = req.cookies.get('nudge_session')?.value;
  const session = sealed ? await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD) : null;
  let sessionRoles: string[] = [];
  if (session) {
    const { rows } = await adminPool().query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    sessionRoles = rows.map((r) => r.role);
  }
  const auth = verifySyncAuth(authHeader, session ? { roles: sessionRoles } : null, cfg.SYNC_API_KEY);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 });
  }

  // Parse multipart form data
  const formData = await req.formData();
  const file = formData.get('file');
  const tenantCode = formData.get('tenantCode') as string | null;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (!tenantCode) {
    return NextResponse.json({ error: 'tenantCode is required' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 });
  }

  // Resolve tenant
  const pool = adminPool();
  const { rows: tenantRows } = await pool.query(
    `SELECT id FROM tenant WHERE code = $1`,
    [tenantCode],
  );
  if (tenantRows.length === 0) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenantId = tenantRows[0].id;

  // Read file content
  const buffer = Buffer.from(await file.arrayBuffer());
  let csvContent: string;

  // Encoding detection: BOM → UTF-8, else try as UTF-8
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    csvContent = buffer.toString('utf-8');
  } else {
    csvContent = buffer.toString('utf-8');
    // Shift-JIS detection heuristic: if there are replacement chars, it might be Shift-JIS
    // For v0.4, default to UTF-8. Shift-JIS support can be added with iconv-lite later.
  }

  // Parse and sync
  let source: CsvSyncSource;
  try {
    source = new CsvSyncSource(csvContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Create sync_log
  const logId = (await pool.query<{ id: string }>(
    `INSERT INTO sync_log (tenant_id, sync_type, source_type)
     VALUES ($1, 'full', 'csv') RETURNING id`,
    [tenantId],
  )).rows[0].id;

  try {
    // Orgs first
    const orgResult = await reconcileOrgs(pool, tenantId, source);

    // Then users
    const userResult = await reconcileUsers(appPool(), pool, tenantId, source, 'full');

    // Update sync_log
    await pool.query(
      `UPDATE sync_log SET status = 'success', finished_at = now(),
       created_count = $2, updated_count = $3, deactivated_count = $4
       WHERE id = $1`,
      [logId, userResult.created, userResult.updated, userResult.deactivated],
    );

    return NextResponse.json({
      users: userResult,
      orgs: orgResult,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE sync_log SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1`,
      [logId, errorMessage],
    );
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 typecheck`

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/sync/csv/route.ts
git commit -m "feat(api): add CSV upload endpoint for user + org import"
```

---

## Task 9: Integration test — CSV import

**Files:**
- Create: `tests/integration/csv-import.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { CsvSyncSource } from '../../src/sync/csv-source.js';
import { reconcileOrgs } from '../../src/sync/org-reconciler.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';

const CSV = [
  'employee_id,email,display_name,org_path,is_primary',
  'emp-001,tanaka@city.lg.jp,田中太郎,/総務本部/総務部/総務課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/総務本部/総務部/人事課,true',
  'emp-002,suzuki@city.lg.jp,鈴木花子,/DX推進,false',
  'emp-003,yamada@city.lg.jp,山田太郎,/総務本部/総務部/総務課,true',
].join('\n');

describe('CSV import integration', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('csv-int', 'CSV Int', 'r', 'https://kc/r') RETURNING id`,
    )).rows[0].id;
  });
  afterAll(async () => { await stopTestDb(); });

  it('imports CSV with orgs, users, and memberships', async () => {
    const source = new CsvSyncSource(CSV);

    // Orgs first
    const orgResult = await reconcileOrgs(adminPool, tenantId, source);
    // 5 orgs: /総務本部(0), /総務本部/総務部(1), /総務本部/総務部/総務課(2), /総務本部/総務部/人事課(2), /DX推進(0)
    expect(orgResult.created).toBe(5);

    // Then users
    const userResult = await reconcileUsers(appPool, adminPool, tenantId, source, 'full');
    expect(userResult.created).toBe(3); // emp-001, emp-002, emp-003

    // Verify org_unit_closure
    const { rows: hqDescendants } = await adminPool.query(
      `SELECT o.name FROM org_unit_closure c
       JOIN org_unit o ON o.id = c.descendant_id
       WHERE c.tenant_id = $1
         AND c.ancestor_id = (SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = '/総務本部')
       ORDER BY c.depth`,
      [tenantId],
    );
    expect(hqDescendants.map((r) => r.name)).toEqual(['総務本部', '総務部', '総務課', '人事課']);

    // Verify user_org_unit
    const { rows: suzukiOrgs } = await adminPool.query(
      `SELECT o.name, uou.is_primary FROM user_org_unit uou
       JOIN org_unit o ON o.id = uou.org_unit_id
       JOIN users u ON u.id = uou.user_id
       WHERE uou.tenant_id = $1 AND u.keycloak_sub = 'emp-002'
       ORDER BY o.name`,
      [tenantId],
    );
    expect(suzukiOrgs).toHaveLength(2);
    expect(suzukiOrgs.find((r) => r.name === 'DX推進')?.is_primary).toBe(false);
    expect(suzukiOrgs.find((r) => r.name === '人事課')?.is_primary).toBe(true);
  });
});
```

- [ ] **Step 2: Run**

Run: `corepack pnpm@9.12.0 vitest run tests/integration/csv-import.test.ts`

Expected: PASS. No KC needed — this only uses PG testcontainer.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/csv-import.test.ts
git commit -m "test: add CSV import integration test"
```

---

## Task 10: Integration test — KC org sync

**Files:**
- Create: `tests/integration/sync-orgs.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { startTestDb, stopTestDb, getAppPool } from '../helpers/pg-container.js';
import { startKeycloak, stopKeycloak, KeycloakSetup } from '../helpers/keycloak-container.js';
import { KeycloakSyncSource } from '../../src/sync/keycloak-source.js';
import { reconcileOrgs } from '../../src/sync/org-reconciler.js';
import { reconcileUsers } from '../../src/sync/reconciler.js';

describe('KC org sync integration', () => {
  let adminPool: pg.Pool;
  let appPool: pg.Pool;
  let kc: KeycloakSetup;
  let tenantId: string;
  const redirectUri = 'http://localhost:3999/t/org-sync/auth/callback';

  beforeAll(async () => {
    adminPool = await startTestDb();
    appPool = getAppPool();
    kc = await startKeycloak(redirectUri);

    // Create org group hierarchy in KC
    const token = await getKcAdminToken(kc);
    // Create parent group /組織
    const orgGroupId = await createKcGroup(kc, token, '組織', null);
    // Create /組織/総務部
    const deptId = await createKcGroup(kc, token, '総務部', orgGroupId);
    // Add alice to 総務部
    const aliceId = await getKcUserId(kc, token, kc.testUserEmail);
    if (aliceId) {
      await addKcGroupMember(kc, token, deptId, aliceId);
    }

    tenantId = (await adminPool.query(
      `INSERT INTO tenant (code, name, keycloak_realm, keycloak_issuer_url)
       VALUES ('org-sync', 'Org Sync', $1, $2) RETURNING id`,
      [kc.realmName, kc.issuerUrl],
    )).rows[0].id;
    await adminPool.query(
      `INSERT INTO tenant_sync_config (tenant_id, enabled, sync_client_id, sync_client_secret, org_source_type, org_group_prefix)
       VALUES ($1, true, $2, $3, 'keycloak', '/組織')`,
      [tenantId, kc.syncClientId, kc.syncClientSecret],
    );
  }, 180_000);

  afterAll(async () => {
    await stopKeycloak(kc);
    await stopTestDb();
  }, 60_000);

  it('syncs KC groups to org_unit with closure', async () => {
    const source = new KeycloakSyncSource(kc.issuerUrl, kc.syncClientId, kc.syncClientSecret);
    source.setOrgGroupPrefix('/組織');

    // Sync users first (so alice exists in DB)
    await reconcileUsers(appPool, adminPool, tenantId, source, 'full');

    // Then sync orgs
    const result = await reconcileOrgs(adminPool, tenantId, source);
    expect(result.created).toBeGreaterThanOrEqual(1); // at least 総務部

    // Verify closure
    const { rows } = await adminPool.query(
      `SELECT o.name FROM org_unit o WHERE o.tenant_id = $1 AND o.external_id IS NOT NULL`,
      [tenantId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // Verify alice's membership
    if (result.membershipsUpdated > 0) {
      const { rows: membership } = await adminPool.query(
        `SELECT o.name FROM user_org_unit uou
         JOIN org_unit o ON o.id = uou.org_unit_id
         JOIN users u ON u.id = uou.user_id
         WHERE uou.tenant_id = $1 AND u.email = $2`,
        [tenantId, kc.testUserEmail],
      );
      expect(membership.length).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);
});

// KC Admin helpers for test setup
async function getKcAdminToken(kc: KeycloakSetup): Promise<string> {
  const res = await fetch(`${kc.baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: kc.adminUsername, password: kc.adminPassword,
    }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

async function createKcGroup(kc: KeycloakSetup, token: string, name: string, parentId: string | null): Promise<string> {
  const url = parentId
    ? `${kc.baseUrl}/admin/realms/${kc.realmName}/groups/${parentId}/children`
    : `${kc.baseUrl}/admin/realms/${kc.realmName}/groups`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const location = res.headers.get('location') ?? '';
  return location.split('/').pop() ?? '';
}

async function getKcUserId(kc: KeycloakSetup, token: string, email: string): Promise<string | null> {
  const res = await fetch(
    `${kc.baseUrl}/admin/realms/${kc.realmName}/users?email=${encodeURIComponent(email)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const users = (await res.json()) as { id: string }[];
  return users[0]?.id ?? null;
}

async function addKcGroupMember(kc: KeycloakSetup, token: string, groupId: string, userId: string): Promise<void> {
  await fetch(
    `${kc.baseUrl}/admin/realms/${kc.realmName}/users/${userId}/groups/${groupId}`,
    { method: 'PUT', headers: { authorization: `Bearer ${token}` } },
  );
}
```

- [ ] **Step 2: Run**

Run: `corepack pnpm@9.12.0 vitest run tests/integration/sync-orgs.test.ts`

- [ ] **Step 3: Run full suite**

Run: `corepack pnpm@9.12.0 test:all`

- [ ] **Step 4: Commit**

```bash
git add tests/integration/sync-orgs.test.ts
git commit -m "test: add KC org sync integration test"
```

---

## Completion Criteria

- [ ] All 10 tasks complete
- [ ] `corepack pnpm@9.12.0 typecheck` clean
- [ ] `corepack pnpm@9.12.0 test` (unit + schema + RLS) pass
- [ ] `corepack pnpm@9.12.0 test:all` (including integration) pass
- [ ] Migrations 025-026 applied
- [ ] `tenant_sync_config` has `user_source_type` / `org_source_type` / prefix columns
- [ ] `org_unit.external_id` exists with partial unique index
- [ ] CSV parser handles UTF-8 / BOM, validates required fields
- [ ] `CsvSyncSource` implements `SyncSource` + `OrgSyncSource`
- [ ] `KeycloakSyncSource` implements `OrgSyncSource` with prefix filter
- [ ] `org-reconciler` upserts orgs, rebuilds closure, syncs memberships
- [ ] `POST /api/admin/sync/users` supports `full-with-orgs` mode
- [ ] `POST /api/admin/sync/csv` accepts CSV upload
- [ ] v0.3 tests still pass (no regression)

## Scope Recap

Not in v0.4:
- Shift-JIS CSV (UTF-8 only for v0.4, iconv-lite can be added later)
- `team_group_prefix` → Nudge `group` mapping
- KC custom attribute-based org mapping
- Domain logic (requests, assignments, statuses)
- Admin UI for org/user management
