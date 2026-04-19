# v0.7 Requester & Manager UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add requester-side management (sent requests + progress) and manager-side management (subordinate requests + substitute) on top of v0.6 UI. Includes per-assignee filter/search and integrated inline chat.

**Architecture:** Extend existing `listRequests` with `scope=sent`, add new `listAssignees` domain + API for per-assignee progress with filtering. New UI components (`<AssigneeList>`, `<ProgressBar>`, `<RequesterSection>`) composed into existing detail page. Migration 029 adds `last_viewed_by_requester_at` for thread unread tracking.

**Tech Stack:** Next.js 15, React 19, PostgreSQL 17, Tailwind CSS, shadcn/ui, vitest

---

## Phase 1: Database + Domain Layer

### Task 1: Migration 029 — last_viewed_by_requester_at

**Files:**
- Create: `migrations/029_last_viewed_by_requester.sql`
- Create: `tests/schema/request-last-viewed.test.ts`

- [ ] **Step 1: Write migration**

```sql
-- 029: Requester-side last-view tracking for chat unread indicator
ALTER TABLE request ADD COLUMN last_viewed_by_requester_at TIMESTAMPTZ;
```

- [ ] **Step 2: Write schema test**

```ts
// tests/schema/request-last-viewed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 029: request.last_viewed_by_requester_at', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('column exists as nullable timestamptz', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='request' AND column_name='last_viewed_by_requester_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('timestamp with time zone');
    expect(rows[0].is_nullable).toBe('YES');
  });
});
```

- [ ] **Step 3: Run test**

Run: `corepack pnpm@9.12.0 vitest run tests/schema/request-last-viewed.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add migrations/029_last_viewed_by_requester.sql tests/schema/request-last-viewed.test.ts
git commit -m "feat(db): add request.last_viewed_by_requester_at (migration 029)"
```

---

### Task 2: listSentRequests — domain + scope=sent support

**Files:**
- Modify: `src/domain/request/list.ts`
- Create: `src/domain/request/list-sent.ts`
- Create: `tests/unit/domain/request/list-sent.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/domain/request/list-sent.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { listSentRequests } from '../../../../src/domain/request/list-sent.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return { userId, tenantId, isTenantAdmin: false, isTenantWideRequester: false, ...opts };
}

describe('listSentRequests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns only requests created by the actor with progress breakdown', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'Sent R1', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
      ],
    });

    // memberA responds
    await getPool().query(
      `UPDATE assignment SET status='responded' WHERE request_id=$1 AND user_id=$2`,
      [r.id, s.users.memberA],
    );

    const result = await listSentRequests(getAppPool(), adminCtx, {});
    const item = result.items.find((i) => i.id === r.id);
    expect(item).toBeDefined();
    expect(item!.title).toBe('Sent R1');
    expect(item!.total).toBe(2);
    expect(item!.responded).toBe(1);
    expect(item!.unopened).toBe(1);
    expect(item!.done).toBe(1);
  });

  it('filters by status=in_progress (unopened or opened present)', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r1 = await createRequest(getAppPool(), adminCtx, {
      title: 'Active', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const r2 = await createRequest(getAppPool(), adminCtx, {
      title: 'Done', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberB }],
    });
    // Mark r2 all done
    await getPool().query(
      `UPDATE assignment SET status='responded' WHERE request_id=$1`,
      [r2.id],
    );

    const active = await listSentRequests(getAppPool(), adminCtx, { filter: 'in_progress' });
    expect(active.items.map((i) => i.title)).toContain('Active');
    expect(active.items.map((i) => i.title)).not.toContain('Done');

    const done = await listSentRequests(getAppPool(), adminCtx, { filter: 'done' });
    expect(done.items.map((i) => i.title)).toContain('Done');
    expect(done.items.map((i) => i.title)).not.toContain('Active');
  });

  it('sorts by due_at ASC NULLS LAST, then undone DESC', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const soon = await createRequest(getAppPool(), adminCtx, {
      title: 'Soon', body: '', dueAt: new Date(Date.now() + 3600000).toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const later = await createRequest(getAppPool(), adminCtx, {
      title: 'Later', body: '', dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberB }],
    });
    const result = await listSentRequests(getAppPool(), adminCtx, {});
    const titles = result.items.map((i) => i.title);
    const soonIdx = titles.indexOf('Soon');
    const laterIdx = titles.indexOf('Later');
    expect(soonIdx).toBeLessThan(laterIdx);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/list-sent.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write implementation**

```ts
// src/domain/request/list-sent.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type SentFilter = 'all' | 'in_progress' | 'done';

export type ListSentRequestsInput = {
  filter?: SentFilter;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type SentRequestItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  total: number;
  unopened: number;
  opened: number;
  responded: number;
  unavailable: number;
  other: number;
  done: number;
  overdueCount: number;
};

export type ListSentRequestsResult = {
  items: SentRequestItem[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function listSentRequests(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListSentRequestsInput,
): Promise<ListSentRequestsResult> {
  const rawPage = input.page;
  const rawPageSize = input.pageSize;
  const page = Math.max(
    1,
    Number.isFinite(rawPage) && rawPage !== undefined && rawPage > 0 ? Math.floor(rawPage) : 1,
  );
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Number.isFinite(rawPageSize) && rawPageSize !== undefined && rawPageSize > 0
        ? Math.floor(rawPageSize)
        : DEFAULT_PAGE_SIZE,
    ),
  );
  const offset = (page - 1) * pageSize;
  const filter = input.filter ?? 'all';
  const qPattern = input.q?.trim() ? `%${input.q.trim()}%` : null;

  return withTenant(pool, actor.tenantId, async (client) => {
    const params: unknown[] = [actor.userId];
    let whereTitle = '';
    if (qPattern) {
      params.push(qPattern);
      whereTitle = `AND r.title ILIKE $${params.length}`;
    }

    let havingFilter = '';
    if (filter === 'in_progress') {
      havingFilter = `HAVING COUNT(*) FILTER (WHERE a.status IN ('unopened','opened')) > 0`;
    } else if (filter === 'done') {
      havingFilter = `HAVING COUNT(*) FILTER (WHERE a.status IN ('unopened','opened')) = 0
                        AND COUNT(a.*) > 0`;
    }

    // Count query (same filter criteria)
    const countSql = `
      SELECT COUNT(*)::int AS n FROM (
        SELECT r.id
        FROM request r
        LEFT JOIN assignment a ON a.request_id = r.id
        WHERE r.created_by_user_id = $1 ${whereTitle}
        GROUP BY r.id
        ${havingFilter}
      ) t
    `;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    params.push(pageSize, offset);
    const sql = `
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
          WHERE a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')
        )::int AS done,
        COUNT(*) FILTER (
          WHERE a.status IN ('unopened','opened')
            AND r.due_at IS NOT NULL AND r.due_at < now()
        )::int AS overdue_count
      FROM request r
      LEFT JOIN assignment a ON a.request_id = r.id
      WHERE r.created_by_user_id = $1 ${whereTitle}
      GROUP BY r.id
      ${havingFilter}
      ORDER BY r.due_at ASC NULLS LAST,
               (COUNT(a.*) - COUNT(*) FILTER (
                 WHERE a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')
               )) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query(sql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        status: r.status,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        total: r.total,
        unopened: r.unopened,
        opened: r.opened,
        responded: r.responded,
        unavailable: r.unavailable,
        other: r.other,
        done: r.done,
        overdueCount: r.overdue_count,
      })),
      total,
      page,
      pageSize,
    };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/list-sent.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/list-sent.ts tests/unit/domain/request/list-sent.test.ts
git commit -m "feat(domain): listSentRequests with progress breakdown + filters"
```

---

### Task 3: listSubordinateRequests — same shape as sent but restricted to subordinates

**Files:**
- Create: `src/domain/request/list-subordinate.ts`
- Create: `tests/unit/domain/request/list-subordinate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/domain/request/list-subordinate.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { listSubordinateRequests } from '../../../../src/domain/request/list-subordinate.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return { userId, tenantId, isTenantAdmin: false, isTenantWideRequester: false, ...opts };
}

describe('listSubordinateRequests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns requests where assignee is in managed subtree, counts only subordinates', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'R1', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },    // orgTeam (subordinate)
        { type: 'user', userId: s.users.outsider },   // orgSibling (not subordinate)
      ],
    });
    const managerCtx = ctx(s.tenantId, s.users.manager);
    const result = await listSubordinateRequests(getAppPool(), managerCtx, {});
    const item = result.items.find((i) => i.id === r.id);
    expect(item).toBeDefined();
    // Only memberA counted, outsider excluded
    expect(item!.total).toBe(1);
  });

  it('returns empty for non-manager user', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    await createRequest(getAppPool(), adminCtx, {
      title: 'R2', body: '', dueAt: new Date().toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const memberCtx = ctx(s.tenantId, s.users.memberB);
    const result = await listSubordinateRequests(getAppPool(), memberCtx, {});
    expect(result.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/list-subordinate.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// src/domain/request/list-subordinate.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type SubordinateFilter = 'all' | 'in_progress' | 'done';

export type ListSubordinateRequestsInput = {
  filter?: SubordinateFilter;
  q?: string;
  orgUnitId?: string;   // filter within a specific managed org
  page?: number;
  pageSize?: number;
};

export type SubordinateRequestItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  total: number;       // restricted to subordinates
  unopened: number;
  opened: number;
  responded: number;
  unavailable: number;
  other: number;
  done: number;
  overdueCount: number;
};

export type ListSubordinateRequestsResult = {
  items: SubordinateRequestItem[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function listSubordinateRequests(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListSubordinateRequestsInput,
): Promise<ListSubordinateRequestsResult> {
  const rawPage = input.page;
  const rawPageSize = input.pageSize;
  const page = Math.max(
    1,
    Number.isFinite(rawPage) && rawPage !== undefined && rawPage > 0 ? Math.floor(rawPage) : 1,
  );
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Number.isFinite(rawPageSize) && rawPageSize !== undefined && rawPageSize > 0
        ? Math.floor(rawPageSize)
        : DEFAULT_PAGE_SIZE,
    ),
  );
  const offset = (page - 1) * pageSize;
  const filter = input.filter ?? 'all';
  const qPattern = input.q?.trim() ? `%${input.q.trim()}%` : null;

  return withTenant(pool, actor.tenantId, async (client) => {
    const params: unknown[] = [actor.userId];
    let whereTitle = '';
    if (qPattern) {
      params.push(qPattern);
      whereTitle = `AND r.title ILIKE $${params.length}`;
    }
    let whereOrg = '';
    if (input.orgUnitId) {
      params.push(input.orgUnitId);
      whereOrg = `AND ax_org.org_unit_id = $${params.length}`;
    }

    // my_subtree_users: assignee user IDs under my managed orgs
    const subtreeCTE = `
      WITH my_subtree_users AS (
        SELECT DISTINCT uou.user_id
        FROM user_org_unit uou
        JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
        JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
        WHERE m.user_id = $1
      )
    `;

    let havingFilter = '';
    if (filter === 'in_progress') {
      havingFilter = `HAVING COUNT(*) FILTER (
        WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
          AND a.status IN ('unopened','opened')
      ) > 0`;
    } else if (filter === 'done') {
      havingFilter = `HAVING COUNT(*) FILTER (
        WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
          AND a.status IN ('unopened','opened')
      ) = 0 AND COUNT(*) FILTER (
        WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
      ) > 0`;
    }

    const orgJoin = input.orgUnitId
      ? `JOIN user_org_unit ax_org ON ax_org.user_id = a.user_id ${whereOrg}`
      : '';

    const countSql = `
      ${subtreeCTE}
      SELECT COUNT(*)::int AS n FROM (
        SELECT r.id
        FROM request r
        JOIN assignment a ON a.request_id = r.id
        ${orgJoin}
        WHERE a.user_id IN (SELECT user_id FROM my_subtree_users) ${whereTitle}
        GROUP BY r.id
        ${havingFilter}
      ) t
    `;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    params.push(pageSize, offset);
    const sql = `
      ${subtreeCTE}
      SELECT r.id, r.title, r.type, r.status, r.due_at, r.created_at,
        COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users))::int AS total,
        COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users) AND a.status='unopened')::int AS unopened,
        COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users) AND a.status='opened')::int AS opened,
        COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users) AND a.status='responded')::int AS responded,
        COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users) AND a.status='unavailable')::int AS unavailable,
        COUNT(*) FILTER (
          WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
            AND a.status IN ('forwarded','substituted','exempted','expired')
        )::int AS other,
        COUNT(*) FILTER (
          WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
            AND a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')
        )::int AS done,
        COUNT(*) FILTER (
          WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
            AND a.status IN ('unopened','opened')
            AND r.due_at IS NOT NULL AND r.due_at < now()
        )::int AS overdue_count
      FROM request r
      JOIN assignment a ON a.request_id = r.id
      ${orgJoin}
      WHERE a.user_id IN (SELECT user_id FROM my_subtree_users) ${whereTitle}
      GROUP BY r.id
      ${havingFilter}
      ORDER BY r.due_at ASC NULLS LAST,
               (COUNT(*) FILTER (WHERE a.user_id IN (SELECT user_id FROM my_subtree_users))
                - COUNT(*) FILTER (
                  WHERE a.user_id IN (SELECT user_id FROM my_subtree_users)
                    AND a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')
                )) DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query(sql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        status: r.status,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        total: r.total,
        unopened: r.unopened,
        opened: r.opened,
        responded: r.responded,
        unavailable: r.unavailable,
        other: r.other,
        done: r.done,
        overdueCount: r.overdue_count,
      })),
      total,
      page,
      pageSize,
    };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/list-subordinate.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/list-subordinate.ts tests/unit/domain/request/list-subordinate.test.ts
git commit -m "feat(domain): listSubordinateRequests with scope-restricted aggregates"
```

---

### Task 4: listAssignees — per-assignee with filters

**Files:**
- Create: `src/domain/request/assignees.ts`
- Create: `tests/unit/domain/request/assignees.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/domain/request/assignees.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { listAssignees, AssigneesError } from '../../../../src/domain/request/assignees.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return { userId, tenantId, isTenantAdmin: false, isTenantWideRequester: false, ...opts };
}

describe('listAssignees', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester sees all assignees with counts', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
        { type: 'user', userId: s.users.outsider },
      ],
    });
    const result = await listAssignees(getAppPool(), adminCtx, r.id, {});
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.summary.unopened).toBe(3);
  });

  it('manager sees only subordinates', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.outsider },
      ],
    });
    const managerCtx = ctx(s.tenantId, s.users.manager);
    const result = await listAssignees(getAppPool(), managerCtx, r.id, {});
    const names = result.items.map((i) => i.displayName);
    expect(names).toContain('a@test');     // memberA email is display_name in fixture
    expect(names).not.toContain('out@test');
  });

  it('non-requester, non-manager, non-admin rejected', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const outsiderCtx = ctx(s.tenantId, s.users.outsider);
    await expect(
      listAssignees(getAppPool(), outsiderCtx, r.id, {}),
    ).rejects.toBeInstanceOf(AssigneesError);
  });

  it('filters by orgUnitId with includeDescendants', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },   // orgTeam
        { type: 'user', userId: s.users.outsider },  // orgSibling
      ],
    });
    // Filter to orgTeam only
    const result = await listAssignees(getAppPool(), adminCtx, r.id, {
      orgUnitId: s.orgTeam, includeDescendants: false,
    });
    expect(result.items).toHaveLength(1);
  });

  it('filters by status', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
      ],
    });
    await getPool().query(
      `UPDATE assignment SET status='responded' WHERE request_id=$1 AND user_id=$2`,
      [r.id, s.users.memberA],
    );
    const result = await listAssignees(getAppPool(), adminCtx, r.id, {
      statuses: ['unopened'],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].status).toBe('unopened');
  });

  it('counts comments and detects hasUnread for requester', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const { rows: asg } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`, [r.id],
    );
    // Comment from assignee (memberA) after request.last_viewed_by_requester_at (which is NULL)
    await getPool().query(
      `INSERT INTO request_comment (tenant_id, request_id, assignment_id, author_user_id, body)
       VALUES ($1,$2,$3,$4,'hi')`,
      [s.tenantId, r.id, asg[0].id, s.users.memberA],
    );

    const result = await listAssignees(getAppPool(), adminCtx, r.id, {});
    expect(result.items[0].commentCount).toBe(1);
    expect(result.items[0].hasUnread).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/assignees.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// src/domain/request/assignees.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext, AssignmentStatus } from '../types';

export class AssigneesError extends Error {
  constructor(msg: string, readonly code: 'permission_denied' | 'not_found') {
    super(msg);
    this.name = 'AssigneesError';
  }
}

export type ListAssigneesInput = {
  q?: string;
  orgUnitId?: string;
  includeDescendants?: boolean;
  groupId?: string;
  statuses?: AssignmentStatus[];
  hasUnread?: boolean;
  page?: number;
  pageSize?: number;
};

export type AssigneeItem = {
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
  hasUnread: boolean;
};

export type AssigneeSummary = {
  unopened: number;
  opened: number;
  responded: number;
  unavailable: number;
  forwarded: number;
  substituted: number;
  exempted: number;
  expired: number;
  overdue: number;
};

export type ListAssigneesResult = {
  items: AssigneeItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: AssigneeSummary;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type AccessMode = 'requester' | 'manager' | 'denied';

async function checkAccess(
  client: pg.PoolClient,
  actor: ActorContext,
  requestId: string,
): Promise<AccessMode> {
  const { rows } = await client.query<{ created_by_user_id: string }>(
    `SELECT created_by_user_id FROM request WHERE id = $1`,
    [requestId],
  );
  if (rows.length === 0) return 'denied';
  if (rows[0].created_by_user_id === actor.userId) return 'requester';
  if (actor.isTenantAdmin || actor.isTenantWideRequester) return 'requester';

  // Check manager path
  const { rows: mgr } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM assignment a
       JOIN user_org_unit uou ON uou.user_id = a.user_id
       JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
       JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
       WHERE a.request_id = $1 AND m.user_id = $2
     ) AS ok`,
    [requestId, actor.userId],
  );
  return mgr[0].ok ? 'manager' : 'denied';
}

export async function listAssignees(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
  input: ListAssigneesInput,
): Promise<ListAssigneesResult> {
  const rawPage = input.page;
  const rawPageSize = input.pageSize;
  const page = Math.max(
    1,
    Number.isFinite(rawPage) && rawPage !== undefined && rawPage > 0 ? Math.floor(rawPage) : 1,
  );
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Number.isFinite(rawPageSize) && rawPageSize !== undefined && rawPageSize > 0
        ? Math.floor(rawPageSize)
        : DEFAULT_PAGE_SIZE,
    ),
  );
  const offset = (page - 1) * pageSize;

  return withTenant(pool, actor.tenantId, async (client) => {
    const access = await checkAccess(client, actor, requestId);
    if (access === 'denied') {
      throw new AssigneesError('forbidden', 'permission_denied');
    }

    const params: unknown[] = [requestId];
    const conditions: string[] = [];

    // Manager scope restriction
    if (access === 'manager') {
      params.push(actor.userId);
      conditions.push(`a.user_id IN (
        SELECT DISTINCT uou.user_id
        FROM user_org_unit uou
        JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
        JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
        WHERE m.user_id = $${params.length}
      )`);
    }

    // Search by name/email
    if (input.q?.trim()) {
      params.push(`%${input.q.trim()}%`);
      conditions.push(`(u.display_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }

    // Org filter
    if (input.orgUnitId) {
      params.push(input.orgUnitId);
      if (input.includeDescendants) {
        conditions.push(`a.user_id IN (
          SELECT DISTINCT uou2.user_id
          FROM user_org_unit uou2
          JOIN org_unit_closure c2 ON c2.descendant_id = uou2.org_unit_id
          WHERE c2.ancestor_id = $${params.length}
        )`);
      } else {
        conditions.push(`a.user_id IN (
          SELECT user_id FROM user_org_unit WHERE org_unit_id = $${params.length}
        )`);
      }
    }

    // Group filter
    if (input.groupId) {
      params.push(input.groupId);
      conditions.push(`a.user_id IN (
        SELECT user_id FROM group_member WHERE group_id = $${params.length}
      )`);
    }

    // Status filter
    if (input.statuses && input.statuses.length > 0) {
      params.push(input.statuses);
      conditions.push(`a.status = ANY($${params.length}::text[])`);
    }

    // hasUnread filter (requires comment scan)
    if (input.hasUnread === true) {
      conditions.push(`EXISTS (
        SELECT 1 FROM request_comment rc
        WHERE rc.assignment_id = a.id
          AND rc.author_user_id <> $2
          AND (r.last_viewed_by_requester_at IS NULL
               OR rc.created_at > r.last_viewed_by_requester_at)
      )`);
      // $2 here requires a requester user reference — use actor.userId
      // But $2 might be occupied by manager-scope param. Better: use a different approach.
      // Simplified: reuse actor.userId param if available, else push
      // For correctness let's push separately:
      params.push(actor.userId);
      // replace last pushed $2 reference with actual param index
      conditions[conditions.length - 1] = `EXISTS (
        SELECT 1 FROM request_comment rc
        WHERE rc.assignment_id = a.id
          AND rc.author_user_id <> $${params.length}
          AND (r.last_viewed_by_requester_at IS NULL
               OR rc.created_at > r.last_viewed_by_requester_at)
      )`;
    }

    const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

    // Count query (same filters, no paging)
    const countSql = `
      SELECT COUNT(*)::int AS n
      FROM assignment a
      JOIN request r ON r.id = a.request_id
      JOIN users u ON u.id = a.user_id
      WHERE a.request_id = $1 ${whereClause}
    `;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    // Summary (same filters)
    const summarySql = `
      SELECT
        COUNT(*) FILTER (WHERE a.status='unopened')::int AS unopened,
        COUNT(*) FILTER (WHERE a.status='opened')::int AS opened,
        COUNT(*) FILTER (WHERE a.status='responded')::int AS responded,
        COUNT(*) FILTER (WHERE a.status='unavailable')::int AS unavailable,
        COUNT(*) FILTER (WHERE a.status='forwarded')::int AS forwarded,
        COUNT(*) FILTER (WHERE a.status='substituted')::int AS substituted,
        COUNT(*) FILTER (WHERE a.status='exempted')::int AS exempted,
        COUNT(*) FILTER (WHERE a.status='expired')::int AS expired,
        COUNT(*) FILTER (
          WHERE a.status IN ('unopened','opened')
            AND r.due_at IS NOT NULL AND r.due_at < now()
        )::int AS overdue
      FROM assignment a
      JOIN request r ON r.id = a.request_id
      JOIN users u ON u.id = a.user_id
      WHERE a.request_id = $1 ${whereClause}
    `;
    const { rows: sumRows } = await client.query(summarySql, params);

    // Items query
    params.push(pageSize, offset);
    const itemsSql = `
      SELECT
        a.id AS assignment_id,
        a.user_id,
        u.display_name,
        u.email,
        (SELECT o.name FROM user_org_unit uou3
           JOIN org_unit o ON o.id = uou3.org_unit_id
          WHERE uou3.user_id = a.user_id AND uou3.is_primary LIMIT 1
        ) AS org_unit_name,
        a.status,
        (r.due_at IS NOT NULL AND r.due_at < now()
         AND a.status IN ('unopened','opened')) AS is_overdue,
        a.opened_at, a.responded_at, a.action_at,
        (SELECT fu.display_name
           FROM assignment fa
           JOIN users fu ON fu.id = fa.user_id
          WHERE fa.forwarded_from_assignment_id = a.id
          LIMIT 1
        ) AS forwarded_to_name,
        (SELECT COUNT(*)::int FROM request_comment rc
          WHERE rc.assignment_id = a.id) AS comment_count,
        EXISTS (
          SELECT 1 FROM request_comment rc2
          WHERE rc2.assignment_id = a.id
            AND rc2.author_user_id <> $1
            AND (r.last_viewed_by_requester_at IS NULL
                 OR rc2.created_at > r.last_viewed_by_requester_at)
        ) AS has_unread
      FROM assignment a
      JOIN request r ON r.id = a.request_id
      JOIN users u ON u.id = a.user_id
      WHERE a.request_id = $1 ${whereClause}
      ORDER BY u.display_name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    // Note: $1 in items subquery for comment.author_user_id <> $1 is wrong — it's request_id.
    // We need to correlate against actor's assignment(s) for "other author" check.
    // Simpler: "other author" means anyone except the current actor viewing.
    // But requester might have written some comments themselves.
    // Correct interpretation: has_unread = there exists a comment where the comment's author
    // is NOT the request's creator AND created_at > last_viewed_by_requester_at.
    // Since the requester is the only one who cares about has_unread, use created_by_user_id:
    const fixedItemsSql = itemsSql.replace(
      `rc2.author_user_id <> $1`,
      `rc2.author_user_id <> r.created_by_user_id`,
    );
    const { rows } = await client.query(fixedItemsSql, params);

    return {
      total,
      page,
      pageSize,
      summary: {
        unopened: sumRows[0].unopened,
        opened: sumRows[0].opened,
        responded: sumRows[0].responded,
        unavailable: sumRows[0].unavailable,
        forwarded: sumRows[0].forwarded,
        substituted: sumRows[0].substituted,
        exempted: sumRows[0].exempted,
        expired: sumRows[0].expired,
        overdue: sumRows[0].overdue,
      },
      items: rows.map((r) => ({
        assignmentId: r.assignment_id,
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        orgUnitName: r.org_unit_name,
        status: r.status,
        isOverdue: r.is_overdue,
        openedAt: r.opened_at ? new Date(r.opened_at).toISOString() : null,
        respondedAt: r.responded_at ? new Date(r.responded_at).toISOString() : null,
        actionAt: r.action_at ? new Date(r.action_at).toISOString() : null,
        forwardedToName: r.forwarded_to_name,
        commentCount: r.comment_count,
        hasUnread: r.has_unread,
      })),
    };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/assignees.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/assignees.ts tests/unit/domain/request/assignees.test.ts
git commit -m "feat(domain): listAssignees with filters and requester/manager access"
```

---

### Task 5: substituteAssignment — add chat system message

**Files:**
- Modify: `src/domain/assignment/actions.ts`
- Modify: `tests/unit/domain/assignment/actions.test.ts`

- [ ] **Step 1: Write failing test (add to existing file)**

Append this test to `tests/unit/domain/assignment/actions.test.ts`:

```ts
  it('substituteAssignment records system message in assignee chat', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId, requestId } = await seedAssignment(s, s.users.memberA);
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.admin),
      assignmentId, { reason: 'taking over' },
    );
    const { rows } = await getPool().query(
      `SELECT body, author_user_id FROM request_comment
        WHERE assignment_id=$1 ORDER BY created_at`,
      [assignmentId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Find the system message (authored by the substituting actor = admin)
    const systemMsg = rows.find((r) => r.author_user_id === s.users.admin);
    expect(systemMsg).toBeDefined();
    expect(systemMsg!.body).toMatch(/代理完了/);
    expect(systemMsg!.body).toMatch(/taking over/);
  });
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/actions.test.ts`
Expected: only the new test FAILs

- [ ] **Step 3: Modify substituteAssignment**

In `src/domain/assignment/actions.ts`, find the `substituteAssignment` function and locate the block after `recordHistory` but within the `if (actor.userId !== asg.user_id)` branch. Replace the notification-only block with:

```ts
    if (actor.userId !== asg.user_id) {
      // Record a system message in the assignee's chat thread
      const { rows: actorRows } = await client.query<{ display_name: string }>(
        `SELECT display_name FROM users WHERE id=$1`,
        [actor.userId],
      );
      const actorName = actorRows[0]?.display_name ?? actor.userId;
      const msg = `${actorName} さんが代理完了にしました。\n理由: ${input.reason}`;
      await client.query(
        `INSERT INTO request_comment
           (tenant_id, request_id, assignment_id, author_user_id, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [actor.tenantId, asg.request_id, asg.id, actor.userId, msg],
      );

      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: asg.user_id,
        requestId: asg.request_id,
        assignmentId: asg.id,
        kind: 'completed',
        payload: { substitutedBy: actor.userId, reason: input.reason },
      });
    }
```

- [ ] **Step 4: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/actions.test.ts`
Expected: all passed (including existing 9 + new 1 = 10)

- [ ] **Step 5: Commit**

```bash
git add src/domain/assignment/actions.ts tests/unit/domain/assignment/actions.test.ts
git commit -m "feat(domain): substituteAssignment records system message in chat"
```

---

### Task 6: markViewedByRequester — update last_viewed_by_requester_at

**Files:**
- Create: `src/domain/request/mark-viewed-requester.ts`
- Create: `tests/unit/domain/request/mark-viewed-requester.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/domain/request/mark-viewed-requester.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { markViewedByRequester } from '../../../../src/domain/request/mark-viewed-requester.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(tenantId: string, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return { userId, tenantId, isTenantAdmin: false, isTenantWideRequester: false, ...opts };
}

describe('markViewedByRequester', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('sets last_viewed_by_requester_at when actor is requester', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberA }],
    });

    await markViewedByRequester(getAppPool(), adminCtx, r.id);
    const { rows } = await getPool().query(
      `SELECT last_viewed_by_requester_at FROM request WHERE id=$1`, [r.id],
    );
    expect(rows[0].last_viewed_by_requester_at).not.toBeNull();
  });

  it('no-op when actor is not the requester', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    const r = await createRequest(getAppPool(), adminCtx, {
      title: 'T', body: '',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'task', targets: [{ type: 'user', userId: s.users.memberA }],
    });

    const memberCtx = ctx(s.tenantId, s.users.memberA);
    await markViewedByRequester(getAppPool(), memberCtx, r.id);
    const { rows } = await getPool().query(
      `SELECT last_viewed_by_requester_at FROM request WHERE id=$1`, [r.id],
    );
    expect(rows[0].last_viewed_by_requester_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/mark-viewed-requester.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```ts
// src/domain/request/mark-viewed-requester.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export async function markViewedByRequester(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `UPDATE request
          SET last_viewed_by_requester_at = now()
        WHERE id = $1 AND created_by_user_id = $2`,
      [requestId, actor.userId],
    );
  });
}
```

- [ ] **Step 4: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/mark-viewed-requester.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/mark-viewed-requester.ts tests/unit/domain/request/mark-viewed-requester.test.ts
git commit -m "feat(domain): markViewedByRequester for thread unread tracking"
```

---

## Phase 2: API Layer

### Task 7: /api/requests?scope=sent endpoint

**Files:**
- Modify: `app/t/[code]/api/requests/route.ts`
- Create: `tests/integration/sent-requests.test.ts`

- [ ] **Step 1: Add scope=sent handling to GET**

In `app/t/[code]/api/requests/route.ts`, modify the GET handler to dispatch to `listSentRequests` when `scope=sent`:

```ts
import { listSentRequests } from '@/domain/request/list-sent';
// ...existing imports
```

In the GET handler, before the existing `listRequests` call:

```ts
  const url = req.nextUrl;
  const scope = url.searchParams.get('scope') ?? 'mine';
  const qParam = url.searchParams.get('q') ?? undefined;
  const filterParam = url.searchParams.get('filter') ?? undefined;
  const page = parsePositiveInt(url.searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 50);

  if (scope === 'sent') {
    const result = await listSentRequests(appPool(), guard.actor, {
      filter: filterParam as 'all' | 'in_progress' | 'done' | undefined,
      q: qParam,
      page,
      pageSize,
    });
    return NextResponse.json(result);
  }

  // ... existing scope='mine'|'subordinate'|'all' handling
```

- [ ] **Step 2: Write integration test**

```ts
// tests/integration/sent-requests.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST, GET } from '../../app/t/[code]/api/requests/route.js';

describe('GET /t/:code/api/requests?scope=sent', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns requests created by actor with progress data', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    await POST(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'SentTest', type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [
            { type: 'user', userId: s.users.memberA },
            { type: 'user', userId: s.users.memberB },
          ],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );

    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests?scope=sent`, {
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThan(0);
    const item = body.items.find((i: { title: string }) => i.title === 'SentTest');
    expect(item).toBeDefined();
    expect(item.total).toBe(2);
    expect(item.unopened).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/integration/sent-requests.test.ts`
Expected: PASS

- [ ] **Step 4: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/t/[code]/api/requests/route.ts tests/integration/sent-requests.test.ts
git commit -m "feat(api): add scope=sent to /api/requests"
```

---

### Task 8: /api/requests/[id]/assignees endpoint

**Files:**
- Create: `app/t/[code]/api/requests/[id]/assignees/route.ts`
- Create: `tests/integration/assignees-api.test.ts`

- [ ] **Step 1: Create route handler**

```ts
// app/t/[code]/api/requests/[id]/assignees/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../../_lib/session-guard';
import { listAssignees, AssigneesError } from '@/domain/request/assignees';
import type { AssignmentStatus } from '@/domain/types';

export const runtime = 'nodejs';

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const url = req.nextUrl;
  const q = url.searchParams.get('q') ?? undefined;
  const orgUnitId = url.searchParams.get('orgUnitId') ?? undefined;
  const includeDescendants = url.searchParams.get('includeDescendants') === 'true';
  const groupId = url.searchParams.get('groupId') ?? undefined;
  const statusParam = url.searchParams.get('status');
  const statuses = statusParam ? (statusParam.split(',') as AssignmentStatus[]) : undefined;
  const hasUnreadParam = url.searchParams.get('hasUnread');
  const hasUnread = hasUnreadParam === 'true' ? true : undefined;
  const page = parsePositiveInt(url.searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 50);

  try {
    const result = await listAssignees(appPool(), guard.actor, id, {
      q, orgUnitId, includeDescendants, groupId, statuses, hasUnread, page, pageSize,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AssigneesError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
```

- [ ] **Step 2: Write integration test**

```ts
// tests/integration/assignees-api.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST } from '../../app/t/[code]/api/requests/route.js';
import { GET } from '../../app/t/[code]/api/requests/[id]/assignees/route.js';

describe('GET /t/:code/api/requests/:id/assignees', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester sees all assignees with summary', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const createRes = await POST(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Asg', type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [
            { type: 'user', userId: s.users.memberA },
            { type: 'user', userId: s.users.memberB },
          ],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await createRes.json();

    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/assignees`,
        { headers: { cookie: adminCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.summary.unopened).toBe(2);
  });

  it('outsider gets 403', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const createRes = await POST(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Asg2', type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await createRes.json();

    const outsiderCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/requests/${requestId}/assignees`,
        { headers: { cookie: outsiderCookie } },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: requestId }) },
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `corepack pnpm@9.12.0 vitest run tests/integration/assignees-api.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/t/[code]/api/requests/[id]/assignees/route.ts tests/integration/assignees-api.test.ts
git commit -m "feat(api): assignees endpoint with filtering and role-based scope"
```

---

## Phase 3: UI Components

### Task 9: ProgressBar + AccessBanner components

**Files:**
- Create: `src/ui/components/progress-bar.tsx`
- Create: `src/ui/components/access-banner.tsx`
- Create: `tests/unit/ui/progress-bar.test.tsx`

- [ ] **Step 1: Create ProgressBar component**

```tsx
// src/ui/components/progress-bar.tsx
import { cn } from '@/lib/utils';

type Props = {
  counts: {
    unopened: number;
    opened: number;
    responded: number;
    unavailable: number;
    other: number;
  };
  total: number;
  className?: string;
};

export function ProgressBar({ counts, total, className }: Props) {
  if (total === 0) {
    return <div className={cn('h-2 bg-gray-200 rounded-full', className)} />;
  }
  const segments = [
    { color: 'bg-green-500', width: (counts.responded / total) * 100, label: '対応済み' },
    { color: 'bg-red-400', width: (counts.unavailable / total) * 100, label: '対応不可' },
    { color: 'bg-purple-400', width: (counts.other / total) * 100, label: 'その他完了' },
    { color: 'bg-gray-400', width: (counts.opened / total) * 100, label: '開封済み' },
    { color: 'bg-blue-300', width: (counts.unopened / total) * 100, label: '未開封' },
  ];
  return (
    <div
      className={cn('flex h-2 rounded-full overflow-hidden bg-gray-100', className)}
      role="progressbar"
      aria-valuenow={counts.responded + counts.unavailable + counts.other}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      {segments.map((seg, i) =>
        seg.width > 0 ? (
          <div
            key={i}
            className={seg.color}
            style={{ width: `${seg.width}%` }}
            title={`${seg.label}: ${Math.round(seg.width)}%`}
          />
        ) : null,
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create AccessBanner component**

```tsx
// src/ui/components/access-banner.tsx
export function AccessBanner({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
      <span>🔒</span>
      <span>{text}</span>
    </div>
  );
}
```

- [ ] **Step 3: Write ProgressBar test**

```tsx
// tests/unit/ui/progress-bar.test.tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressBar } from '../../../src/ui/components/progress-bar';

describe('ProgressBar', () => {
  it('renders with correct width segments', () => {
    const { container } = render(
      <ProgressBar
        counts={{ unopened: 2, opened: 1, responded: 5, unavailable: 1, other: 1 }}
        total={10}
      />,
    );
    const segments = container.querySelectorAll('[style*="width"]');
    expect(segments.length).toBeGreaterThan(0);
  });

  it('renders empty bar when total is 0', () => {
    const { container } = render(
      <ProgressBar
        counts={{ unopened: 0, opened: 0, responded: 0, unavailable: 0, other: 0 }}
        total={0}
      />,
    );
    expect(container.querySelector('.bg-gray-200')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run test**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/ui/progress-bar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/progress-bar.tsx src/ui/components/access-banner.tsx tests/unit/ui/progress-bar.test.tsx
git commit -m "feat(ui): ProgressBar and AccessBanner components"
```

---

### Task 10: AssigneeListFilters component

**Files:**
- Create: `src/ui/components/assignee-list-filters.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/components/assignee-list-filters.tsx
'use client';

import { useState, useEffect } from 'react';
import type { AssignmentStatus } from '@/domain/types';

type OrgNode = { id: string; name: string; memberCount: number; children: OrgNode[] };

type Props = {
  tenantCode: string;
  onChange: (filters: {
    q: string;
    orgUnitId: string | null;
    includeDescendants: boolean;
    groupId: string | null;
    statuses: AssignmentStatus[];
    hasUnread: boolean;
  }) => void;
};

type GroupItem = { id: string; name: string };

function flattenOrgs(nodes: OrgNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((n) => [
    { id: n.id, label: '　'.repeat(depth) + n.name },
    ...flattenOrgs(n.children, depth + 1),
  ]);
}

export function AssigneeListFilters({ tenantCode, onChange }: Props) {
  const [q, setQ] = useState('');
  const [orgUnitId, setOrgUnitId] = useState<string>('');
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const [groupId, setGroupId] = useState<string>('');
  const [statuses, setStatuses] = useState<AssignmentStatus[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  const [orgs, setOrgs] = useState<Array<{ id: string; label: string }>>([]);
  const [groups, setGroups] = useState<GroupItem[]>([]);

  useEffect(() => {
    fetch(`/t/${tenantCode}/api/org-tree`)
      .then((r) => r.json())
      .then((data: OrgNode[]) => setOrgs(flattenOrgs(data)))
      .catch(() => {});
    // Groups endpoint doesn't exist yet; leave empty for now (future extension)
  }, [tenantCode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange({
        q,
        orgUnitId: orgUnitId || null,
        includeDescendants,
        groupId: groupId || null,
        statuses,
        hasUnread,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [q, orgUnitId, includeDescendants, groupId, statuses, hasUnread, onChange]);

  const statusOptions: Array<{ value: AssignmentStatus; label: string }> = [
    { value: 'unopened', label: '未開封' },
    { value: 'opened', label: '開封済み' },
    { value: 'responded', label: '対応済み' },
    { value: 'unavailable', label: '対応不可' },
    { value: 'forwarded', label: '転送済み' },
    { value: 'substituted', label: '代理完了' },
    { value: 'exempted', label: '免除' },
  ];

  return (
    <div className="space-y-2 p-3 bg-gray-50 rounded-md border border-gray-200">
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={orgUnitId}
          onChange={(e) => setOrgUnitId(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="">すべての組織</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includeDescendants}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
          />
          配下含む
        </label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
        >
          <option value="">グループ指定なし</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {statusOptions.map((opt) => {
          const active = statuses.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setStatuses((prev) =>
                  active ? prev.filter((s) => s !== opt.value) : [...prev, opt.value],
                );
              }}
              className={`text-xs px-2 py-1 rounded-full border ${
                active
                  ? 'bg-blue-100 border-blue-400 text-blue-800'
                  : 'bg-white border-gray-300 text-gray-600'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="名前・メールで検索"
          className="flex-1 min-w-[180px] text-sm border border-gray-300 rounded px-2 py-1"
        />
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={hasUnread}
            onChange={(e) => setHasUnread(e.target.checked)}
          />
          未読のみ
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/assignee-list-filters.tsx
git commit -m "feat(ui): AssigneeListFilters with org/group/status/search/unread"
```

---

### Task 11: AssigneeList component with inline chat + substitute button

**Files:**
- Create: `src/ui/components/assignee-list.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/components/assignee-list.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from './status-badge';
import { AssigneeListFilters } from './assignee-list-filters';
import type { AssignmentStatus } from '@/domain/types';

type AssigneeItem = {
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
  hasUnread: boolean;
};

type Summary = {
  unopened: number; opened: number; responded: number;
  unavailable: number; forwarded: number; substituted: number;
  exempted: number; expired: number; overdue: number;
};

type CommentItem = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type Props = {
  tenantCode: string;
  requestId: string;
  currentUserId: string;
  canSubstitute: boolean;
};

export function AssigneeList({ tenantCode, requestId, currentUserId, canSubstitute }: Props) {
  const [items, setItems] = useState<AssigneeItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<{
    q: string; orgUnitId: string | null; includeDescendants: boolean;
    groupId: string | null; statuses: AssignmentStatus[]; hasUnread: boolean;
  }>({
    q: '', orgUnitId: null, includeDescendants: true,
    groupId: null, statuses: [], hasUnread: false,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filters.q) qs.set('q', filters.q);
      if (filters.orgUnitId) qs.set('orgUnitId', filters.orgUnitId);
      if (filters.orgUnitId) qs.set('includeDescendants', String(filters.includeDescendants));
      if (filters.groupId) qs.set('groupId', filters.groupId);
      if (filters.statuses.length > 0) qs.set('status', filters.statuses.join(','));
      if (filters.hasUnread) qs.set('hasUnread', 'true');
      const res = await fetch(
        `/t/${tenantCode}/api/requests/${requestId}/assignees?${qs.toString()}`,
      );
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
        setSummary(data.summary);
      }
    } finally {
      setLoading(false);
    }
  }, [tenantCode, requestId, filters]);

  useEffect(() => { fetchList(); }, [fetchList]);

  return (
    <div className="space-y-3">
      <AssigneeListFilters tenantCode={tenantCode} onChange={setFilters} />

      {summary && (
        <div className="text-xs text-gray-600 flex gap-3 flex-wrap">
          <span>未開封: {summary.unopened}</span>
          <span>開封: {summary.opened}</span>
          <span>対応済み: {summary.responded}</span>
          <span>対応不可: {summary.unavailable}</span>
          {summary.overdue > 0 && (
            <span className="text-red-600 font-medium">期限切れ: {summary.overdue}</span>
          )}
        </div>
      )}

      {loading && <p className="text-xs text-gray-400">読み込み中...</p>}

      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.assignmentId} className="border border-gray-200 rounded-md bg-white">
            <button
              type="button"
              onClick={() => setExpanded(expanded === item.assignmentId ? null : item.assignmentId)}
              className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-gray-50"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-medium text-sm truncate">{item.displayName}</span>
                <span className="text-xs text-gray-500 truncate">{item.orgUnitName ?? ''}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {item.commentCount > 0 && (
                  <span className="text-xs text-gray-500">💬 {item.commentCount}</span>
                )}
                {item.hasUnread && <span className="text-blue-500 text-xs">🔵</span>}
                <StatusBadge status={item.status} overdue={item.isOverdue} />
                {item.forwardedToName && (
                  <span className="text-xs text-purple-600">→ {item.forwardedToName}</span>
                )}
              </div>
            </button>

            {expanded === item.assignmentId && (
              <AssigneeDetail
                tenantCode={tenantCode}
                requestId={requestId}
                assignmentId={item.assignmentId}
                currentUserId={currentUserId}
                status={item.status}
                canSubstitute={canSubstitute && ['unopened', 'opened'].includes(item.status)}
                onRefresh={fetchList}
              />
            )}
          </li>
        ))}
        {items.length === 0 && !loading && (
          <li className="text-sm text-gray-500 text-center py-4">該当する assignee がいません</li>
        )}
      </ul>
    </div>
  );
}

function AssigneeDetail({
  tenantCode, requestId, assignmentId, currentUserId, status, canSubstitute, onRefresh,
}: {
  tenantCode: string; requestId: string; assignmentId: string;
  currentUserId: string; status: AssignmentStatus; canSubstitute: boolean;
  onRefresh: () => void;
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [newBody, setNewBody] = useState('');
  const [sending, setSending] = useState(false);
  const [showSubstituteDialog, setShowSubstituteDialog] = useState(false);
  const [substituteReason, setSubstituteReason] = useState('');

  const loadComments = useCallback(async () => {
    const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}/comments`);
    if (res.ok) {
      const data = await res.json();
      const thread = data.allThreads?.[assignmentId] ?? [];
      setComments(thread);
    }
  }, [tenantCode, requestId, assignmentId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  async function postReply() {
    if (!newBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/requests/${requestId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: newBody, assignmentId }),
      });
      if (res.ok) {
        setNewBody('');
        await loadComments();
      }
    } finally {
      setSending(false);
    }
  }

  async function substitute() {
    setSending(true);
    try {
      const res = await fetch(`/t/${tenantCode}/api/assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'substitute', reason: substituteReason }),
      });
      if (res.ok) {
        setShowSubstituteDialog(false);
        setSubstituteReason('');
        await loadComments();
        onRefresh();
      } else {
        const data = await res.json();
        alert(data.error ?? '代理完了に失敗しました');
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="px-3 py-3 border-t border-gray-100 bg-gray-50 space-y-3">
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {comments.length === 0 && (
          <p className="text-xs text-gray-400">やり取りはありません</p>
        )}
        {comments.map((c) => {
          const isMe = c.authorUserId === currentUserId;
          return (
            <div key={c.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                isMe ? 'bg-blue-100 text-blue-900' : 'bg-white text-gray-800 border border-gray-200'
              }`}>
                <div className="text-xs font-medium mb-0.5">{c.authorName}</div>
                <div className="whitespace-pre-wrap">{c.body}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(c.createdAt).toLocaleString('ja-JP')}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && newBody.trim()) {
              e.preventDefault();
              postReply();
            }
          }}
          placeholder="返信..."
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        />
        <button
          onClick={postReply}
          disabled={sending || !newBody.trim()}
          className="px-4 py-1.5 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50"
        >
          送信
        </button>
      </div>

      {canSubstitute && (
        <>
          <button
            onClick={() => setShowSubstituteDialog(true)}
            className="text-sm px-3 py-1.5 border border-orange-300 text-orange-700 rounded-md hover:bg-orange-50"
          >
            👤 代理完了
          </button>
          {showSubstituteDialog && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
                <h3 className="font-bold mb-3">代理完了の理由（必須）</h3>
                <textarea
                  value={substituteReason}
                  onChange={(e) => setSubstituteReason(e.target.value)}
                  className="w-full border border-gray-300 rounded-md p-2 text-sm mb-4 min-h-[60px]"
                  placeholder="代理完了する理由を入力..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowSubstituteDialog(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={substitute}
                    disabled={sending || !substituteReason.trim()}
                    className="px-4 py-2 bg-orange-600 text-white rounded-md text-sm disabled:opacity-50"
                  >
                    代理完了する
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/assignee-list.tsx
git commit -m "feat(ui): AssigneeList with inline chat and substitute action"
```

---

### Task 12: RequesterSection component

**Files:**
- Create: `src/ui/components/requester-section.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/ui/components/requester-section.tsx
'use client';

import { AccessBanner } from './access-banner';
import { ProgressBar } from './progress-bar';
import { AssigneeList } from './assignee-list';

type Props = {
  tenantCode: string;
  requestId: string;
  currentUserId: string;
  canSubstitute: boolean;
  summary: {
    unopened: number; opened: number; responded: number;
    unavailable: number; forwarded: number; substituted: number;
    exempted: number; expired: number;
  };
  total: number;
};

export function RequesterSection({
  tenantCode, requestId, currentUserId, canSubstitute, summary, total,
}: Props) {
  const done = summary.responded + summary.unavailable + summary.forwarded
    + summary.substituted + summary.exempted + summary.expired;
  const other = summary.forwarded + summary.substituted + summary.exempted + summary.expired;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section className="mt-6 space-y-3">
      <AccessBanner text="依頼者のみ閲覧可能" />

      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">全体進捗</h2>
          <span className="text-sm text-gray-600">{done}/{total}（{pct}%）</span>
        </div>
        <ProgressBar
          counts={{
            unopened: summary.unopened,
            opened: summary.opened,
            responded: summary.responded,
            unavailable: summary.unavailable,
            other,
          }}
          total={total}
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">👥 assignee 一覧</h2>
        <AssigneeList
          tenantCode={tenantCode}
          requestId={requestId}
          currentUserId={currentUserId}
          canSubstitute={canSubstitute}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/requester-section.tsx
git commit -m "feat(ui): RequesterSection composing access banner, progress, and AssigneeList"
```

---

## Phase 4: Pages

### Task 13: /sent page + sidebar menu item

**Files:**
- Create: `app/t/[code]/sent/page.tsx`
- Modify: `src/ui/components/sidebar.tsx` (add "送信した依頼" menu)

- [ ] **Step 1: Create sent page**

```tsx
// app/t/[code]/sent/page.tsx
import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { listSentRequests } from '@/domain/request/list-sent';
import { ProgressBar } from '@/ui/components/progress-bar';
import Link from 'next/link';

export const runtime = 'nodejs';

export default async function SentRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const { code } = await params;
  const { filter = 'all', q, page: pageStr = '1' } = await searchParams;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) return <div>Unauthorized</div>;

  const page = Math.max(1, Number(pageStr) || 1);
  const result = await listSentRequests(
    appPool(),
    { userId: session.userId, tenantId: session.tenantId, isTenantAdmin: false, isTenantWideRequester: false },
    { filter: filter as 'all' | 'in_progress' | 'done', q, page, pageSize: 20 },
  );

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-4">📤 送信した依頼</h1>

      <div className="flex gap-0 border-b-2 border-gray-200 mb-4">
        <Link
          href={`/t/${code}/sent?filter=all`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'all' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          すべて
        </Link>
        <Link
          href={`/t/${code}/sent?filter=in_progress`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'in_progress' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          進行中
        </Link>
        <Link
          href={`/t/${code}/sent?filter=done`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'done' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          完了
        </Link>
      </div>

      <div className="space-y-2">
        {result.items.length === 0 && (
          <p className="text-gray-500 text-center py-8">送信した依頼はありません</p>
        )}
        {result.items.map((item) => {
          const other = item.other;
          return (
            <Link
              key={item.id}
              href={`/t/${code}/requests/${item.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 no-underline"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-medium text-gray-900 truncate">{item.title}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.overdueCount > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full">
                      ⚠️ 期限切れ {item.overdueCount}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">
                    {item.done}/{item.total}
                  </span>
                </div>
              </div>
              <ProgressBar
                counts={{
                  unopened: item.unopened,
                  opened: item.opened,
                  responded: item.responded,
                  unavailable: item.unavailable,
                  other,
                }}
                total={item.total}
              />
              <div className="flex gap-3 mt-2 text-xs text-gray-500">
                {item.dueAt && (
                  <span>締切: {new Date(item.dueAt).toLocaleDateString('ja-JP')}</span>
                )}
                <span>未開封 {item.unopened}</span>
                <span>対応済み {item.responded}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {result.total > page * 20 && (
        <div className="text-center mt-4">
          <Link
            href={`/t/${code}/sent?filter=${filter}&page=${page + 1}`}
            className="text-blue-600 text-sm hover:underline"
          >
            もっと見る
          </Link>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update sidebar to include "送信した依頼" menu**

In `src/ui/components/sidebar.tsx`, add a new nav item:

```tsx
const NAV_ITEMS = [
  { href: 'requests', label: '自分宛の依頼', icon: '📥' },
  { href: 'requests/new', label: '新規依頼作成', icon: '➕' },
  { href: 'sent', label: '送信した依頼', icon: '📤' },
];
```

Note: Task 14 will further modify the sidebar to accept an `isManager` prop and conditionally add a subordinates menu. In Task 13, just add "sent" to the base list — Task 14 replaces `NAV_ITEMS` with a dynamic version.

- [ ] **Step 3: Typecheck + manual check**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add app/t/[code]/sent/page.tsx src/ui/components/sidebar.tsx
git commit -m "feat(ui): sent requests page + sidebar menu"
```

---

### Task 14: /subordinates page + conditional sidebar menu

**Files:**
- Create: `app/t/[code]/subordinates/page.tsx`
- Modify: `src/ui/components/sidebar.tsx` (accept isManager prop)
- Modify: `app/t/[code]/layout.tsx` (detect manager role and pass to sidebar)

- [ ] **Step 1: Update layout to detect manager role**

In `app/t/[code]/layout.tsx`, add a query to check if the user is an `org_unit_manager`:

```tsx
import { withTenant } from '@/db/with-tenant';
import { appPool } from '@/db/pools';
// ... existing imports

// In the component, after resolving session:
const isManager = await withTenant(appPool(), session.tenantId, async (client) => {
  const { rows } = await client.query(
    `SELECT 1 FROM org_unit_manager WHERE user_id = $1 LIMIT 1`,
    [session.userId],
  );
  return rows.length > 0;
});

// Pass isManager to Sidebar:
<Sidebar tenantCode={code} displayName={session.displayName} isManager={isManager} />
```

- [ ] **Step 2: Update Sidebar to conditionally show the subordinate menu**

```tsx
// In src/ui/components/sidebar.tsx, change the component props and NAV_ITEMS:
type Props = {
  tenantCode: string;
  displayName: string;
  isManager: boolean;
};

const BASE_NAV_ITEMS = [
  { href: 'requests', label: '自分宛の依頼', icon: '📥' },
  { href: 'requests/new', label: '新規依頼作成', icon: '➕' },
  { href: 'sent', label: '送信した依頼', icon: '📤' },
];

export function Sidebar({ tenantCode, displayName, isManager }: Props) {
  const navItems = isManager
    ? [...BASE_NAV_ITEMS, { href: 'subordinates', label: '部下の依頼', icon: '👥' }]
    : BASE_NAV_ITEMS;
  // ... rest of component uses navItems instead of NAV_ITEMS
}
```

- [ ] **Step 3: Create subordinates page**

```tsx
// app/t/[code]/subordinates/page.tsx
import { cookies } from 'next/headers';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { appPool } from '@/db/pools';
import { withTenant } from '@/db/with-tenant';
import { listSubordinateRequests } from '@/domain/request/list-subordinate';
import { ProgressBar } from '@/ui/components/progress-bar';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const runtime = 'nodejs';

export default async function SubordinatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ filter?: string; q?: string; page?: string }>;
}) {
  const { code } = await params;
  const { filter = 'all', q, page: pageStr = '1' } = await searchParams;

  const cfg = loadConfig();
  const sealed = (await cookies()).get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) return <div>Unauthorized</div>;

  // Manager check
  const isManager = await withTenant(appPool(), session.tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM org_unit_manager WHERE user_id = $1 LIMIT 1`,
      [session.userId],
    );
    return rows.length > 0;
  });
  if (!isManager) {
    redirect(`/t/${code}/requests`);
  }

  const page = Math.max(1, Number(pageStr) || 1);
  const result = await listSubordinateRequests(
    appPool(),
    { userId: session.userId, tenantId: session.tenantId, isTenantAdmin: false, isTenantWideRequester: false },
    { filter: filter as 'all' | 'in_progress' | 'done', q, page, pageSize: 20 },
  );

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-4">👥 部下の依頼</h1>

      <div className="flex gap-0 border-b-2 border-gray-200 mb-4">
        <Link
          href={`/t/${code}/subordinates?filter=all`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'all' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          すべて
        </Link>
        <Link
          href={`/t/${code}/subordinates?filter=in_progress`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'in_progress' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          進行中
        </Link>
        <Link
          href={`/t/${code}/subordinates?filter=done`}
          className={`px-4 py-2 text-sm font-medium no-underline -mb-0.5 ${
            filter === 'done' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'
          }`}
        >
          完了
        </Link>
      </div>

      <div className="space-y-2">
        {result.items.length === 0 && (
          <p className="text-gray-500 text-center py-8">部下の依頼はありません</p>
        )}
        {result.items.map((item) => {
          const other = item.other;
          return (
            <Link
              key={item.id}
              href={`/t/${code}/requests/${item.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 no-underline"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <span className="font-medium text-gray-900 truncate">{item.title}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {item.overdueCount > 0 && (
                    <span className="text-xs px-2 py-0.5 bg-red-50 text-red-600 rounded-full">
                      ⚠️ 期限切れ {item.overdueCount}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">{item.done}/{item.total}</span>
                </div>
              </div>
              <ProgressBar
                counts={{
                  unopened: item.unopened,
                  opened: item.opened,
                  responded: item.responded,
                  unavailable: item.unavailable,
                  other,
                }}
                total={item.total}
              />
              <div className="flex gap-3 mt-2 text-xs text-gray-500">
                {item.dueAt && (
                  <span>締切: {new Date(item.dueAt).toLocaleDateString('ja-JP')}</span>
                )}
                <span>配下未開封 {item.unopened}</span>
                <span>配下対応済み {item.responded}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add app/t/[code]/subordinates/page.tsx app/t/[code]/layout.tsx src/ui/components/sidebar.tsx
git commit -m "feat(ui): subordinates page with manager-only sidebar menu"
```

---

### Task 15: Integrate RequesterSection into /requests/[id]

**Files:**
- Modify: `app/t/[code]/requests/[id]/page.tsx`

- [ ] **Step 1: Add requester section + mark-viewed call**

Modify `app/t/[code]/requests/[id]/page.tsx` to:

1. Import `RequesterSection` and `listAssignees` and `markViewedByRequester`
2. Compute `canViewRequesterSection` based on role and management
3. If `canViewRequesterSection`, call `listAssignees` with page=1, pageSize=1 to get the summary
4. If actor is the requester, call `markViewedByRequester` fire-and-forget
5. Render `<RequesterSection>` below the existing content when `canViewRequesterSection`

```tsx
import { RequesterSection } from '@/ui/components/requester-section';
import { listAssignees } from '@/domain/request/assignees';
import { markViewedByRequester } from '@/domain/request/mark-viewed-requester';
// ... existing imports

// Inside the component, after loading `data`:
const actor = {
  userId: session.userId,
  tenantId: session.tenantId,
  isTenantAdmin: false,
  isTenantWideRequester: false,
};

const isRequesterStrict = req.created_by_user_id === session.userId;

// Check management status
const isManager = await withTenant(appPool(), session.tenantId, async (client) => {
  const { rows } = await client.query(
    `SELECT 1 FROM org_unit_manager WHERE user_id = $1 LIMIT 1`,
    [session.userId],
  );
  return rows.length > 0;
});

// Check: is this actor manager of any assignee on this request?
const isManagerOfAny = isManager
  ? await withTenant(appPool(), session.tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT EXISTS(
           SELECT 1 FROM assignment a
           JOIN user_org_unit uou ON uou.user_id = a.user_id
           JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
           JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
           WHERE a.request_id = $1 AND m.user_id = $2
         ) AS ok`,
        [id, session.userId],
      );
      return rows[0].ok;
    })
  : false;

const canViewRequesterSection = isRequesterStrict || isManagerOfAny;

let requesterSummary: Awaited<ReturnType<typeof listAssignees>> | null = null;
if (canViewRequesterSection) {
  requesterSummary = await listAssignees(appPool(), actor, id, { pageSize: 1 });
}

if (isRequesterStrict) {
  void markViewedByRequester(appPool(), actor, id).catch(() => {});
}

// ... existing render

// Below existing content, add:
{canViewRequesterSection && requesterSummary && (
  <RequesterSection
    tenantCode={code}
    requestId={id}
    currentUserId={session.userId}
    canSubstitute={isRequesterStrict || isManagerOfAny}
    summary={{
      unopened: requesterSummary.summary.unopened,
      opened: requesterSummary.summary.opened,
      responded: requesterSummary.summary.responded,
      unavailable: requesterSummary.summary.unavailable,
      forwarded: requesterSummary.summary.forwarded,
      substituted: requesterSummary.summary.substituted,
      exempted: requesterSummary.summary.exempted,
      expired: requesterSummary.summary.expired,
    }}
    total={requesterSummary.total}
  />
)}
```

Note: existing `isRequester` logic for the comment thread (which hides "broadcast" when user is also assignee) stays as-is.

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add app/t/[code]/requests/[id]/page.tsx
git commit -m "feat(ui): integrate RequesterSection into request detail page"
```

---

## Phase 5: Verification

### Task 16: Full suite + manual test

- [ ] **Step 1: Run full test suite**

Run: `corepack pnpm@9.12.0 run test:all`
Expected: all pass (approximately 260+ tests)

- [ ] **Step 2: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`
Expected: clean

- [ ] **Step 3: Start dev server and manually verify**

Run: `corepack pnpm@9.12.0 dev`

Manual checks:
1. Log in as a user who has sent requests. Navigate to `/t/dev/sent`. Verify list shows progress bars and correct counts.
2. Tabs (すべて/進行中/完了) filter works.
3. Click into a request detail page. Verify the 🔒 banner appears with assignee list.
4. Expand an assignee row. Verify chat loads and you can send a reply.
5. If logged in as a manager, verify "👥 部下の依頼" appears in sidebar and `/t/dev/subordinates` shows configured subordinates' requests.
6. From detail page (as manager or requester), try the 代理完了 button. Verify the assignee's chat shows the system message.

- [ ] **Step 4: Commit any fixes if needed**

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
git merge --no-ff feat/v07-requester-manager-ui -m "Merge branch 'feat/v07-requester-manager-ui': v0.7 Requester & Manager UI"
```
