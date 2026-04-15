# v0.5 Domain Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement backend domain logic for v0.5 — request creation with target expansion, assignment state machine, forwarding, substitution (代理完了), notification record generation — as REST APIs with full test coverage. UI is deferred to v0.6+.

**Architecture:** Route Handlers (`app/t/[code]/api/...`) are thin: session check + input validation + dispatch. Domain functions live in `src/domain/` as pool-receiving async functions called inside `withTenant()` transactions. Pure state-machine logic (transitions.ts) is a separate unit testable without DB. Integration tests go through the Route Handlers against a real PostgreSQL testcontainer via `appPool` to exercise RLS.

**Tech Stack:** Next.js 15 App Router (Node runtime), PostgreSQL 17 with RLS, pg, vitest, @testcontainers/postgresql

---

## Terminology Reconciliation (important — read before Task 1)

The design spec uses English-language status names that do NOT match the existing database schema. The plan uses the **DB names** throughout. Mapping:

| Spec term | DB term (use this) |
|---|---|
| resolved / 対応済み | `responded` |
| rejected / 対応不可 | `unavailable` |
| delegated / 代理完了 | `substituted` |
| forwarded / 転送済み | `forwarded` |
| exempted / 免除 | `exempted` |
| target type `role` | `group` (DB uses `group` table, not a role concept) |
| target type `all` | `all` (new — added in migration 027) |
| `created_by` | `created_by_user_id` |
| "全社依頼権限" | `user_role.role = 'tenant_wide_requester'` |
| "上長" | `org_unit_manager` table (NOT tenant_admin) |

Existing tables already provide:
- `assignment_status_history` — captures reason, forwarded_to_user_id, transition_kind per transition. **Use this for all history; do not add history columns to `assignment`.**
- `assignment.forwarded_from_assignment_id` — existing FROM-direction link. New forwarded assignments point back at their parent via this column.
- `user_role.role` — enum `tenant_admin | tenant_wide_requester`.
- `org_unit_manager` — maps user → managed org_unit (for substitution permission).

`transition_kind` enum values (from migration 012):
`auto_open | user_respond | user_unavailable | user_forward | manager_substitute | admin_exempt | auto_expire`

---

## File Structure

**New files:**
- `migrations/027_request_target_all_and_action_at.sql`
- `src/domain/assignment/transitions.ts` — pure state machine
- `src/domain/assignment/actions.ts` — open/respond/unavailable/forward/substitute/exempt
- `src/domain/assignment/permissions.ts` — canSubstitute, isManagerOf
- `src/domain/request/create.ts` — create request + expand
- `src/domain/request/expand-targets.ts` — 4 target type expanders
- `src/domain/request/list.ts` — scope filter (mine/subordinate/all)
- `src/domain/request/permissions.ts` — canTargetOutsideScope, visibility checks
- `src/domain/notification/emit.ts` — notification row inserter
- `src/domain/types.ts` — shared ActorContext type
- `app/t/[code]/api/requests/route.ts` — POST / GET
- `app/t/[code]/api/requests/[id]/route.ts` — GET
- `app/t/[code]/api/assignments/route.ts` — GET
- `app/t/[code]/api/assignments/[id]/route.ts` — PATCH
- `app/t/[code]/api/_lib/session-guard.ts` — shared helper for session + tenant resolution
- `tests/helpers/fixtures/domain-scenario.ts` — org hierarchy + users + roles fixture
- `tests/schema/request-target-all.test.ts`
- `tests/schema/assignment-action-at.test.ts`
- `tests/unit/domain/assignment/transitions.test.ts`
- `tests/unit/domain/assignment/permissions.test.ts`
- `tests/unit/domain/assignment/actions.test.ts`
- `tests/unit/domain/request/expand-targets.test.ts`
- `tests/unit/domain/request/permissions.test.ts`
- `tests/unit/domain/request/create.test.ts`
- `tests/unit/domain/request/list.test.ts`
- `tests/unit/domain/notification/emit.test.ts`
- `tests/integration/request-create-flow.test.ts`
- `tests/integration/assignment-status-flow.test.ts`
- `tests/integration/assignment-forward.test.ts`
- `tests/integration/assignment-substitute.test.ts`
- `tests/integration/request-list-scope.test.ts`

**Modified files:**
- None (all existing code stays as-is; plan adds new modules)

---

## Task 1: Migration 027 — allow `target_type='all'` and add `assignment.action_at`

**Files:**
- Create: `migrations/027_request_target_all_and_action_at.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 027: Allow 'all' target type (全社依頼) and add assignment.action_at for sort

-- 1. Drop old PK + CHECK on request_target so we can allow target_id = NULL for 'all'
ALTER TABLE request_target DROP CONSTRAINT request_target_pkey;
ALTER TABLE request_target DROP CONSTRAINT request_target_target_type_check;

-- Add id surrogate PK so partial uniqueness works cleanly
ALTER TABLE request_target ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE request_target ADD PRIMARY KEY (id);

-- Allow NULL target_id for type='all'
ALTER TABLE request_target ALTER COLUMN target_id DROP NOT NULL;

-- New CHECK with 'all'
ALTER TABLE request_target ADD CONSTRAINT request_target_target_type_check
  CHECK (target_type IN ('org_unit', 'group', 'user', 'all'));

-- Shape constraint: 'all' must have NULL target_id; everything else must have NOT NULL
ALTER TABLE request_target ADD CONSTRAINT request_target_target_id_shape
  CHECK (
    (target_type = 'all' AND target_id IS NULL)
    OR (target_type <> 'all' AND target_id IS NOT NULL)
  );

-- Uniqueness: at most one row per (request_id, target_type, target_id),
-- and at most one 'all' row per request.
CREATE UNIQUE INDEX request_target_unique_nonall_idx
  ON request_target (request_id, target_type, target_id)
  WHERE target_type <> 'all';
CREATE UNIQUE INDEX request_target_unique_all_idx
  ON request_target (request_id)
  WHERE target_type = 'all';

-- 2. assignment.action_at — last user action timestamp for sorting
ALTER TABLE assignment ADD COLUMN action_at TIMESTAMPTZ;
CREATE INDEX assignment_tenant_user_action_at_idx
  ON assignment (tenant_id, user_id, action_at DESC NULLS LAST);
```

- [ ] **Step 2: Run test suite to confirm nothing else breaks**

Run: `corepack pnpm@9.12.0 vitest run tests/schema/`
Expected: PASS (existing schema tests still green; new tests for 027 come in Task 2)

- [ ] **Step 3: Commit**

```bash
git add migrations/027_request_target_all_and_action_at.sql
git commit -m "feat(db): add 'all' target_type and assignment.action_at (migration 027)"
```

---

## Task 2: Schema tests for migration 027

**Files:**
- Create: `tests/schema/request-target-all.test.ts`
- Create: `tests/schema/assignment-action-at.test.ts`

- [ ] **Step 1: Write failing test for `request_target` 'all' support**

```ts
// tests/schema/request-target-all.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { randomUUID } from 'node:crypto';

describe('migration 027: request_target allows target_type=all', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('accepts target_type=all with target_id=NULL', async () => {
    const pool = getPool();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO tenant(id, code, name, auth_mode) VALUES ($1,$2,$3,'oidc')`,
      [tenantId, 't' + tenantId.slice(0, 6), 'T'],
    );
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, tenantId, 'kc-' + userId, 'a@x', 'A'],
    );
    await pool.query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','t','active')`,
      [reqId, tenantId, userId],
    );
    await pool.query(
      `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
       VALUES ($1,$2,'all',NULL)`,
      [tenantId, reqId],
    );
    const { rows } = await pool.query(
      `SELECT target_type, target_id FROM request_target WHERE request_id=$1`,
      [reqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('all');
    expect(rows[0].target_id).toBeNull();
  });

  it('rejects target_type=all with non-NULL target_id', async () => {
    const pool = getPool();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO tenant(id, code, name, auth_mode) VALUES ($1,$2,$3,'oidc')`,
      [tenantId, 't' + tenantId.slice(0, 6), 'T'],
    );
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, tenantId, 'kc-' + userId, 'b@x', 'B'],
    );
    await pool.query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','t','active')`,
      [reqId, tenantId, userId],
    );
    await expect(
      pool.query(
        `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
         VALUES ($1,$2,'all',$3)`,
        [tenantId, reqId, randomUUID()],
      ),
    ).rejects.toThrow(/request_target_target_id_shape/);
  });

  it('rejects non-all types with NULL target_id', async () => {
    const pool = getPool();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const reqId = randomUUID();
    await pool.query(
      `INSERT INTO tenant(id, code, name, auth_mode) VALUES ($1,$2,$3,'oidc')`,
      [tenantId, 't' + tenantId.slice(0, 6), 'T'],
    );
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, tenantId, 'kc-' + userId, 'c@x', 'C'],
    );
    await pool.query(
      `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
       VALUES ($1,$2,$3,'task','t','active')`,
      [reqId, tenantId, userId],
    );
    await expect(
      pool.query(
        `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
         VALUES ($1,$2,'user',NULL)`,
        [tenantId, reqId],
      ),
    ).rejects.toThrow(/request_target_target_id_shape/);
  });
});
```

- [ ] **Step 2: Write failing test for `assignment.action_at`**

```ts
// tests/schema/assignment-action-at.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';

describe('migration 027: assignment.action_at', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('assignment has nullable action_at TIMESTAMPTZ', async () => {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_name='assignment' AND column_name='action_at'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('timestamp with time zone');
    expect(rows[0].is_nullable).toBe('YES');
  });
});
```

- [ ] **Step 3: Run tests to verify they PASS (migration is already applied)**

Run: `corepack pnpm@9.12.0 vitest run tests/schema/request-target-all.test.ts tests/schema/assignment-action-at.test.ts`
Expected: 4 passed

- [ ] **Step 4: Commit**

```bash
git add tests/schema/request-target-all.test.ts tests/schema/assignment-action-at.test.ts
git commit -m "test(schema): cover migration 027 (request_target all + assignment.action_at)"
```

---

## Task 3: Domain test fixture — org hierarchy + users + roles

Provides a reusable scenario for domain tests. A 3-level org tree, users in each level, a manager, a tenant_wide_requester, and a plain user.

**Files:**
- Create: `tests/helpers/fixtures/domain-scenario.ts`

- [ ] **Step 1: Write the fixture**

```ts
// tests/helpers/fixtures/domain-scenario.ts
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export type DomainScenario = {
  tenantId: string;
  tenantCode: string;
  orgRoot: string;    // root org_unit
  orgDiv: string;     // child of root (Division)
  orgTeam: string;    // child of div (Team)
  users: {
    admin: string;        // tenant_admin role
    wideReq: string;      // tenant_wide_requester role
    manager: string;      // org_unit_manager of orgDiv
    memberA: string;      // in orgTeam
    memberB: string;      // in orgTeam
    outsider: string;     // in a separate branch
  };
  groupId: string;     // "group" with memberA + memberB
};

export async function createDomainScenario(pool: pg.Pool): Promise<DomainScenario> {
  const tenantId = randomUUID();
  const tenantCode = 't' + tenantId.slice(0, 6);
  await pool.query(
    `INSERT INTO tenant(id, code, name, auth_mode) VALUES ($1,$2,'Test','oidc')`,
    [tenantId, tenantCode],
  );

  const orgRoot = randomUUID();
  const orgDiv = randomUUID();
  const orgTeam = randomUUID();
  const orgSibling = randomUUID();
  for (const [id, name] of [
    [orgRoot, 'Root'],
    [orgDiv, 'Division'],
    [orgTeam, 'Team'],
    [orgSibling, 'Sibling'],
  ] as const) {
    await pool.query(
      `INSERT INTO org_unit(id, tenant_id, name, level) VALUES ($1,$2,$3,0)`,
      [id, tenantId, name],
    );
  }
  // closure: self + parent chains
  const closure: Array<[string, string, number]> = [
    [orgRoot, orgRoot, 0],
    [orgDiv, orgDiv, 0],
    [orgTeam, orgTeam, 0],
    [orgSibling, orgSibling, 0],
    [orgRoot, orgDiv, 1],
    [orgRoot, orgTeam, 2],
    [orgDiv, orgTeam, 1],
    [orgRoot, orgSibling, 1],
  ];
  for (const [anc, desc, depth] of closure) {
    await pool.query(
      `INSERT INTO org_unit_closure(tenant_id, ancestor_id, descendant_id, depth)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, anc, desc, depth],
    );
  }

  async function mkUser(email: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users(id, tenant_id, keycloak_sub, email, display_name, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [id, tenantId, 'kc-' + id, email, email],
    );
    return id;
  }

  const admin = await mkUser('admin@test');
  const wideReq = await mkUser('wide@test');
  const manager = await mkUser('manager@test');
  const memberA = await mkUser('a@test');
  const memberB = await mkUser('b@test');
  const outsider = await mkUser('out@test');

  // org memberships
  const memberships: Array<[string, string, boolean]> = [
    [admin, orgRoot, true],
    [wideReq, orgRoot, true],
    [manager, orgDiv, true],
    [memberA, orgTeam, true],
    [memberB, orgTeam, true],
    [outsider, orgSibling, true],
  ];
  for (const [userId, orgId, primary] of memberships) {
    await pool.query(
      `INSERT INTO user_org_unit(tenant_id, user_id, org_unit_id, is_primary)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, userId, orgId, primary],
    );
  }

  // manager of orgDiv (cascades to orgTeam via closure)
  await pool.query(
    `INSERT INTO org_unit_manager(tenant_id, org_unit_id, user_id) VALUES ($1,$2,$3)`,
    [tenantId, orgDiv, manager],
  );

  // roles
  await pool.query(
    `INSERT INTO user_role(tenant_id, user_id, role) VALUES ($1,$2,'tenant_admin')`,
    [tenantId, admin],
  );
  await pool.query(
    `INSERT INTO user_role(tenant_id, user_id, role)
     VALUES ($1,$2,'tenant_wide_requester')`,
    [tenantId, wideReq],
  );

  // a "group" containing memberA + memberB
  const groupId = randomUUID();
  await pool.query(
    `INSERT INTO "group"(id, tenant_id, name, created_by_user_id)
     VALUES ($1,$2,'TeamAB',$3)`,
    [groupId, tenantId, admin],
  );
  for (const u of [memberA, memberB]) {
    await pool.query(
      `INSERT INTO group_member(tenant_id, group_id, user_id, added_by_user_id)
       VALUES ($1,$2,$3,$4)`,
      [tenantId, groupId, u, admin],
    );
  }

  return {
    tenantId,
    tenantCode,
    orgRoot,
    orgDiv,
    orgTeam,
    users: { admin, wideReq, manager, memberA, memberB, outsider },
    groupId,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers/fixtures/domain-scenario.ts
git commit -m "test(helpers): add domain scenario fixture (org tree + users + roles)"
```

---

## Task 4: Shared ActorContext type and state-machine module (transitions.ts)

Pure functions, no DB. Test exhaustively.

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/assignment/transitions.ts`
- Test: `tests/unit/domain/assignment/transitions.test.ts`

- [ ] **Step 1: Write the types module**

```ts
// src/domain/types.ts
export type AssignmentStatus =
  | 'unopened'
  | 'opened'
  | 'responded'
  | 'unavailable'
  | 'forwarded'
  | 'substituted'
  | 'exempted'
  | 'expired';

export type ActorRole = 'assignee' | 'requester' | 'manager' | 'tenant_admin';

export type ActorContext = {
  userId: string;
  tenantId: string;
  isTenantAdmin: boolean;
  isTenantWideRequester: boolean;
};

export type ExpandBreakdown = {
  user: number;
  org_unit: number;
  group: number;
  all: number;
};
```

- [ ] **Step 2: Write the failing state-machine test**

```ts
// tests/unit/domain/assignment/transitions.test.ts
import { describe, it, expect } from 'vitest';
import {
  canTransition,
  allowedTransitionsFrom,
  type TransitionIntent,
} from '../../../../src/domain/assignment/transitions.js';
import type { AssignmentStatus } from '../../../../src/domain/types.js';

describe('assignment state machine', () => {
  const TERMINAL: AssignmentStatus[] = [
    'responded', 'unavailable', 'forwarded', 'substituted', 'exempted', 'expired',
  ];

  it.each([
    ['unopened', 'opened', 'assignee', true],
    ['unopened', 'responded', 'assignee', true],
    ['unopened', 'unavailable', 'assignee', true],
    ['unopened', 'forwarded', 'assignee', true],
    ['opened', 'responded', 'assignee', true],
    ['opened', 'unavailable', 'assignee', true],
    ['opened', 'forwarded', 'assignee', true],
    ['unopened', 'substituted', 'requester', true],
    ['unopened', 'substituted', 'manager', true],
    ['opened', 'substituted', 'requester', true],
    ['opened', 'substituted', 'manager', true],
    ['unopened', 'substituted', 'assignee', false],
    ['unopened', 'exempted', 'tenant_admin', true],
    ['unopened', 'exempted', 'assignee', false],
    ['unopened', 'responded', 'manager', false],
    ['opened', 'unopened', 'assignee', false],
  ] as const)(
    '%s -> %s by %s => %s',
    (from, to, role, expected) => {
      const intent: TransitionIntent = { from, to, actorRole: role };
      expect(canTransition(intent)).toBe(expected);
    },
  );

  it('rejects any transition from every terminal status', () => {
    for (const from of TERMINAL) {
      expect(allowedTransitionsFrom(from)).toEqual([]);
    }
  });
});
```

- [ ] **Step 3: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/transitions.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 4: Write the implementation**

```ts
// src/domain/assignment/transitions.ts
import type { AssignmentStatus, ActorRole } from '../types.js';

export type ActionName =
  | 'open'
  | 'respond'
  | 'unavailable'
  | 'forward'
  | 'substitute'
  | 'exempt';

export type TransitionRule = {
  to: AssignmentStatus;
  action: ActionName;
  actor: ActorRole;
  transitionKind:
    | 'auto_open'
    | 'user_respond'
    | 'user_unavailable'
    | 'user_forward'
    | 'manager_substitute'
    | 'admin_exempt';
  requiresReason: boolean;
};

export type TransitionIntent = {
  from: AssignmentStatus;
  to: AssignmentStatus;
  actorRole: ActorRole;
};

const RULES: Record<AssignmentStatus, TransitionRule[]> = {
  unopened: [
    { to: 'opened',      action: 'open',       actor: 'assignee', transitionKind: 'auto_open',          requiresReason: false },
    { to: 'responded',   action: 'respond',    actor: 'assignee', transitionKind: 'user_respond',       requiresReason: false },
    { to: 'unavailable', action: 'unavailable',actor: 'assignee', transitionKind: 'user_unavailable',   requiresReason: true  },
    { to: 'forwarded',   action: 'forward',    actor: 'assignee', transitionKind: 'user_forward',       requiresReason: false },
    { to: 'substituted', action: 'substitute', actor: 'requester',transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'substituted', action: 'substitute', actor: 'manager',  transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'exempted',    action: 'exempt',     actor: 'tenant_admin', transitionKind: 'admin_exempt',   requiresReason: true  },
  ],
  opened: [
    { to: 'responded',   action: 'respond',    actor: 'assignee', transitionKind: 'user_respond',       requiresReason: false },
    { to: 'unavailable', action: 'unavailable',actor: 'assignee', transitionKind: 'user_unavailable',   requiresReason: true  },
    { to: 'forwarded',   action: 'forward',    actor: 'assignee', transitionKind: 'user_forward',       requiresReason: false },
    { to: 'substituted', action: 'substitute', actor: 'requester',transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'substituted', action: 'substitute', actor: 'manager',  transitionKind: 'manager_substitute', requiresReason: true  },
    { to: 'exempted',    action: 'exempt',     actor: 'tenant_admin', transitionKind: 'admin_exempt',   requiresReason: true  },
  ],
  responded:   [],
  unavailable: [],
  forwarded:   [],
  substituted: [],
  exempted:    [],
  expired:     [],
};

export function allowedTransitionsFrom(status: AssignmentStatus): TransitionRule[] {
  return RULES[status] ?? [];
}

export function canTransition(intent: TransitionIntent): boolean {
  return allowedTransitionsFrom(intent.from).some(
    (r) => r.to === intent.to && r.actor === intent.actorRole,
  );
}

export function findRule(
  from: AssignmentStatus,
  action: ActionName,
  actorRole: ActorRole,
): TransitionRule | undefined {
  return allowedTransitionsFrom(from).find(
    (r) => r.action === action && r.actor === actorRole,
  );
}
```

- [ ] **Step 5: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/transitions.test.ts`
Expected: all passed

- [ ] **Step 6: Commit**

```bash
git add src/domain/types.ts src/domain/assignment/transitions.ts tests/unit/domain/assignment/transitions.test.ts
git commit -m "feat(domain): add assignment state machine (pure transitions)"
```

---

## Task 5: Request permissions — canTargetOutsideScope and visibility

**Files:**
- Create: `src/domain/request/permissions.ts`
- Test: `tests/unit/domain/request/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/request/permissions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import {
  canTargetOutsideScope,
  getVisibleOrgUnitIds,
} from '../../../../src/domain/request/permissions.js';

describe('request permissions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('canTargetOutsideScope: true for tenant_wide_requester', () => {
    expect(canTargetOutsideScope({
      userId: 'u', tenantId: 't',
      isTenantAdmin: false, isTenantWideRequester: true,
    })).toBe(true);
  });

  it('canTargetOutsideScope: false for plain user', () => {
    expect(canTargetOutsideScope({
      userId: 'u', tenantId: 't',
      isTenantAdmin: false, isTenantWideRequester: false,
    })).toBe(false);
  });

  it('getVisibleOrgUnitIds returns ancestors-self-descendants of user orgs', async () => {
    const pool = getPool();
    const s = await createDomainScenario(pool);
    const visible = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return getVisibleOrgUnitIds(client, s.users.manager);
    });
    // manager is in orgDiv; visible = orgDiv + orgTeam (descendants); ancestors excluded per spec "自組織配下"
    expect(visible.sort()).toEqual([s.orgDiv, s.orgTeam].sort());
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/permissions.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/request/permissions.ts
import type pg from 'pg';
import type { ActorContext } from '../types.js';

export function canTargetOutsideScope(actor: ActorContext): boolean {
  return actor.isTenantWideRequester || actor.isTenantAdmin;
}

/**
 * Returns the set of org_unit ids the user can "see" for targeting purposes:
 * every org_unit the user is a member of, plus all descendants of those units.
 * (Ancestors are deliberately excluded — "自組織配下" not "自組織より上".)
 */
export async function getVisibleOrgUnitIds(
  client: pg.PoolClient,
  userId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ org_unit_id: string }>(
    `SELECT DISTINCT c.descendant_id AS org_unit_id
       FROM user_org_unit uou
       JOIN org_unit_closure c ON c.ancestor_id = uou.org_unit_id
      WHERE uou.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.org_unit_id);
}

/**
 * Group visibility: a user can target a group iff they are a member of it.
 * (Spec 3.3 — "自分が所属していないグループは見えない".)
 */
export async function getVisibleGroupIds(
  client: pg.PoolClient,
  userId: string,
): Promise<string[]> {
  const { rows } = await client.query<{ group_id: string }>(
    `SELECT group_id FROM group_member WHERE user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.group_id);
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/permissions.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/permissions.ts tests/unit/domain/request/permissions.test.ts
git commit -m "feat(domain): add request permissions (scope + visibility queries)"
```

---

## Task 6: Target expansion — expand-targets.ts

Expands a list of target specs into `assignment` rows, one subtype at a time with ON CONFLICT DO NOTHING.

**Files:**
- Create: `src/domain/request/expand-targets.ts`
- Test: `tests/unit/domain/request/expand-targets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/request/expand-targets.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import { expandTargets, type TargetSpec } from '../../../../src/domain/request/expand-targets.js';

async function mkRequest(pool: import('pg').Pool, tenantId: string, createdBy: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','t','active')`,
    [id, tenantId, createdBy],
  );
  return id;
}

describe('expandTargets', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('expands user target to 1 assignment', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'user', userId: s.users.memberA },
      ] satisfies TargetSpec[]);
    });
    expect(breakdown).toEqual({ user: 1, org_unit: 0, group: 0, all: 0 });
  });

  it('expands org_unit with descendants using closure', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'org_unit', orgUnitId: s.orgDiv, includeDescendants: true },
      ]);
    });
    // orgDiv has manager; descendants orgTeam has memberA, memberB => 3 users
    expect(breakdown.org_unit).toBe(3);
  });

  it('expands group target to all members', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'group', groupId: s.groupId },
      ]);
    });
    expect(breakdown.group).toBe(2);
  });

  it('expands all to every active tenant user', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [{ type: 'all' }]);
    });
    // scenario has 6 active users
    expect(breakdown.all).toBe(6);
  });

  it('deduplicates on (request_id, user_id) when user+org overlap', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await mkRequest(getPool(), s.tenantId, s.users.admin);
    const breakdown = await withTenant(getAppPool(), s.tenantId, async (client) => {
      return expandTargets(client, s.tenantId, requestId, [
        { type: 'user', userId: s.users.memberA },
        { type: 'org_unit', orgUnitId: s.orgTeam, includeDescendants: false },
      ]);
    });
    // memberA inserted twice — ON CONFLICT drops the second; counts reflect raw inserts
    expect(breakdown.user).toBe(1);
    expect(breakdown.org_unit).toBe(1); // memberB only; memberA conflicts
    // Verify total distinct assignments
    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    expect(rows[0].n).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/expand-targets.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/request/expand-targets.ts
import type pg from 'pg';
import type { ExpandBreakdown } from '../types.js';

export type TargetSpec =
  | { type: 'user'; userId: string }
  | { type: 'org_unit'; orgUnitId: string; includeDescendants: boolean }
  | { type: 'group'; groupId: string }
  | { type: 'all' };

/**
 * Inserts assignment rows for each target, one subtype at a time, relying on
 * the `UNIQUE (request_id, user_id)` constraint via ON CONFLICT DO NOTHING.
 * Returns the number of rows actually inserted per subtype.
 */
export async function expandTargets(
  client: pg.PoolClient,
  tenantId: string,
  requestId: string,
  targets: TargetSpec[],
): Promise<ExpandBreakdown> {
  const out: ExpandBreakdown = { user: 0, org_unit: 0, group: 0, all: 0 };

  for (const t of targets) {
    if (t.type === 'user') {
      const { rowCount } = await client.query(
        `INSERT INTO assignment(tenant_id, request_id, user_id)
         SELECT $1, $2, u.id
           FROM users u
          WHERE u.id = $3 AND u.tenant_id = $1 AND u.status = 'active'
         ON CONFLICT (request_id, user_id) DO NOTHING`,
        [tenantId, requestId, t.userId],
      );
      out.user += rowCount ?? 0;
    } else if (t.type === 'org_unit') {
      if (t.includeDescendants) {
        const { rowCount } = await client.query(
          `INSERT INTO assignment(tenant_id, request_id, user_id)
           SELECT DISTINCT $1, $2, uou.user_id
             FROM org_unit_closure c
             JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
             JOIN users u ON u.id = uou.user_id AND u.status = 'active'
            WHERE c.ancestor_id = $3
              AND c.tenant_id = $1
           ON CONFLICT (request_id, user_id) DO NOTHING`,
          [tenantId, requestId, t.orgUnitId],
        );
        out.org_unit += rowCount ?? 0;
      } else {
        const { rowCount } = await client.query(
          `INSERT INTO assignment(tenant_id, request_id, user_id)
           SELECT DISTINCT $1, $2, uou.user_id
             FROM user_org_unit uou
             JOIN users u ON u.id = uou.user_id AND u.status = 'active'
            WHERE uou.org_unit_id = $3
              AND uou.tenant_id = $1
           ON CONFLICT (request_id, user_id) DO NOTHING`,
          [tenantId, requestId, t.orgUnitId],
        );
        out.org_unit += rowCount ?? 0;
      }
    } else if (t.type === 'group') {
      const { rowCount } = await client.query(
        `INSERT INTO assignment(tenant_id, request_id, user_id)
         SELECT $1, $2, gm.user_id
           FROM group_member gm
           JOIN users u ON u.id = gm.user_id AND u.status = 'active'
          WHERE gm.group_id = $3 AND gm.tenant_id = $1
         ON CONFLICT (request_id, user_id) DO NOTHING`,
        [tenantId, requestId, t.groupId],
      );
      out.group += rowCount ?? 0;
    } else if (t.type === 'all') {
      const { rowCount } = await client.query(
        `INSERT INTO assignment(tenant_id, request_id, user_id)
         SELECT $1, $2, u.id
           FROM users u
          WHERE u.tenant_id = $1 AND u.status = 'active'
         ON CONFLICT (request_id, user_id) DO NOTHING`,
        [tenantId, requestId],
      );
      out.all += rowCount ?? 0;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/expand-targets.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/expand-targets.ts tests/unit/domain/request/expand-targets.test.ts
git commit -m "feat(domain): expand request targets (user/org_unit/group/all) with dedupe"
```

---

## Task 7: Notification emit helper

**Files:**
- Create: `src/domain/notification/emit.ts`
- Test: `tests/unit/domain/notification/emit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/notification/emit.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import { emitNotification } from '../../../../src/domain/notification/emit.js';
import { randomUUID } from 'node:crypto';

describe('emitNotification', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('inserts a pending in_app notification for a recipient', async () => {
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
      `SELECT recipient_user_id, kind, status, channel, payload_json
         FROM notification WHERE request_id=$1`,
      [reqId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(s.users.memberA);
    expect(rows[0].kind).toBe('created');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].channel).toBe('in_app');
    expect(rows[0].payload_json).toEqual({ title: 't' });
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/notification/emit.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/notification/emit.ts
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

/**
 * Inserts a pending in_app notification row. Actual delivery (email/teams/slack)
 * is handled by the v0.6+ notification worker which reads pending rows.
 */
export async function emitNotification(
  client: pg.PoolClient,
  input: EmitInput,
): Promise<void> {
  await client.query(
    `INSERT INTO notification
       (tenant_id, request_id, assignment_id, recipient_user_id,
        channel, kind, scheduled_at, status, payload_json)
     VALUES ($1, $2, $3, $4, 'in_app', $5, now(), 'pending', $6::jsonb)`,
    [
      input.tenantId,
      input.requestId,
      input.assignmentId,
      input.recipientUserId,
      input.kind,
      JSON.stringify(input.payload),
    ],
  );
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/notification/emit.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/notification/emit.ts tests/unit/domain/notification/emit.test.ts
git commit -m "feat(domain): add notification emit helper (in_app pending rows)"
```

---

## Task 8: Request create — orchestration + permissions

**Files:**
- Create: `src/domain/request/create.ts`
- Test: `tests/unit/domain/request/create.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/request/create.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest, CreateRequestError } from '../../../../src/domain/request/create.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function adminCtx(s: { tenantId: string; users: { admin: string } }): ActorContext {
  return {
    userId: s.users.admin, tenantId: s.tenantId,
    isTenantAdmin: true, isTenantWideRequester: false,
  };
}
function plainCtx(s: { tenantId: string; users: { manager: string } }): ActorContext {
  return {
    userId: s.users.manager, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false,
  };
}

describe('createRequest', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creates request, expands targets, records audit + notifications', async () => {
    const s = await createDomainScenario(getPool());
    const result = await createRequest(getAppPool(), adminCtx(s), {
      title: 'Survey 1',
      body: 'please fill',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'survey',
      targets: [
        { type: 'user', userId: s.users.memberA },
        { type: 'user', userId: s.users.memberB },
      ],
    });
    expect(result.expandedCount).toBe(2);
    expect(result.breakdown.user).toBe(2);

    const { rows: asg } = await getPool().query(
      `SELECT user_id, status FROM assignment WHERE request_id=$1 ORDER BY user_id`,
      [result.id],
    );
    expect(asg.map((r) => r.status)).toEqual(['unopened', 'unopened']);

    const { rows: notif } = await getPool().query(
      `SELECT recipient_user_id FROM notification WHERE request_id=$1`,
      [result.id],
    );
    expect(notif).toHaveLength(2);

    const { rows: audit } = await getPool().query(
      `SELECT action, target_type, target_id FROM audit_log
        WHERE tenant_id=$1 AND target_id=$2`,
      [s.tenantId, result.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('request.created');
  });

  it('rejects type=all when actor lacks tenant_wide_requester', async () => {
    const s = await createDomainScenario(getPool());
    await expect(
      createRequest(getAppPool(), plainCtx(s), {
        title: 'T', body: '', dueAt: new Date().toISOString(),
        type: 'task', targets: [{ type: 'all' }],
      }),
    ).rejects.toBeInstanceOf(CreateRequestError);
  });

  it('rejects org_unit target outside visibility for plain user', async () => {
    const s = await createDomainScenario(getPool());
    // orgSibling is outside manager's scope (not in orgDiv subtree)
    const { rows } = await getPool().query(
      `SELECT id FROM org_unit WHERE tenant_id=$1 AND name='Sibling'`,
      [s.tenantId],
    );
    const sibling = rows[0].id;
    await expect(
      createRequest(getAppPool(), plainCtx(s), {
        title: 'T', body: '', dueAt: new Date().toISOString(),
        type: 'task',
        targets: [{ type: 'org_unit', orgUnitId: sibling, includeDescendants: false }],
      }),
    ).rejects.toThrow(/outside visible scope/);
  });

  it('rejects empty-expansion with CreateRequestError', async () => {
    const s = await createDomainScenario(getPool());
    // create an empty group (same tenant, no members) and target it
    const { rows } = await getPool().query(
      `INSERT INTO "group"(tenant_id, name, created_by_user_id)
       VALUES ($1, 'empty', $2) RETURNING id`,
      [s.tenantId, s.users.admin],
    );
    const emptyGroup = rows[0].id;
    await expect(
      createRequest(getAppPool(), adminCtx(s), {
        title: 'T', body: '', dueAt: new Date().toISOString(),
        type: 'task',
        targets: [{ type: 'group', groupId: emptyGroup }],
      }),
    ).rejects.toThrow(/no targets expanded/);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/create.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/request/create.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext, ExpandBreakdown } from '../types.js';
import { expandTargets, type TargetSpec } from './expand-targets.js';
import {
  canTargetOutsideScope,
  getVisibleOrgUnitIds,
  getVisibleGroupIds,
} from './permissions.js';
import { emitNotification } from '../notification/emit.js';

export type CreateRequestInput = {
  title: string;
  body: string;
  dueAt: string; // ISO8601
  type: 'survey' | 'task';
  targets: TargetSpec[];
};

export type CreateRequestResult = {
  id: string;
  expandedCount: number;
  breakdown: ExpandBreakdown;
};

export class CreateRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'permission_denied'
      | 'invalid_targets'
      | 'empty_expansion'
      | 'validation',
  ) {
    super(message);
    this.name = 'CreateRequestError';
  }
}

export async function createRequest(
  pool: pg.Pool,
  actor: ActorContext,
  input: CreateRequestInput,
): Promise<CreateRequestResult> {
  if (!input.title.trim()) {
    throw new CreateRequestError('title required', 'validation');
  }
  if (input.targets.length === 0) {
    throw new CreateRequestError('targets required', 'validation');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    // Permission: type=all requires tenant_wide_requester or tenant_admin
    const hasAll = input.targets.some((t) => t.type === 'all');
    if (hasAll && !canTargetOutsideScope(actor)) {
      throw new CreateRequestError(
        'tenant-wide target requires permission',
        'permission_denied',
      );
    }

    // Visibility check for plain actors
    if (!canTargetOutsideScope(actor)) {
      const visibleOrgs = new Set(await getVisibleOrgUnitIds(client, actor.userId));
      const visibleGroups = new Set(await getVisibleGroupIds(client, actor.userId));
      for (const t of input.targets) {
        if (t.type === 'org_unit' && !visibleOrgs.has(t.orgUnitId)) {
          throw new CreateRequestError(
            `org_unit ${t.orgUnitId} outside visible scope`,
            'permission_denied',
          );
        }
        if (t.type === 'group' && !visibleGroups.has(t.groupId)) {
          throw new CreateRequestError(
            `group ${t.groupId} outside visible scope`,
            'permission_denied',
          );
        }
        if (t.type === 'user') {
          // user must be in some org descendant of actor's visible org set
          const { rows } = await client.query<{ ok: boolean }>(
            `SELECT EXISTS(
               SELECT 1 FROM user_org_unit uou
               WHERE uou.user_id = $1
                 AND uou.org_unit_id = ANY($2::uuid[])
             ) AS ok`,
            [t.userId, [...visibleOrgs]],
          );
          if (!rows[0].ok) {
            throw new CreateRequestError(
              `user ${t.userId} outside visible scope`,
              'permission_denied',
            );
          }
        }
      }
    }

    // INSERT request
    const { rows: reqRows } = await client.query<{ id: string }>(
      `INSERT INTO request
         (tenant_id, created_by_user_id, type, title, body, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id`,
      [actor.tenantId, actor.userId, input.type, input.title, input.body, input.dueAt],
    );
    const requestId = reqRows[0].id;

    // Record raw target specs for audit
    for (const t of input.targets) {
      if (t.type === 'user') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
           VALUES ($1, $2, 'user', $3)`,
          [actor.tenantId, requestId, t.userId],
        );
      } else if (t.type === 'org_unit') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id, include_descendants)
           VALUES ($1, $2, 'org_unit', $3, $4)`,
          [actor.tenantId, requestId, t.orgUnitId, t.includeDescendants],
        );
      } else if (t.type === 'group') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
           VALUES ($1, $2, 'group', $3)`,
          [actor.tenantId, requestId, t.groupId],
        );
      } else if (t.type === 'all') {
        await client.query(
          `INSERT INTO request_target(tenant_id, request_id, target_type, target_id)
           VALUES ($1, $2, 'all', NULL)`,
          [actor.tenantId, requestId],
        );
      }
    }

    const breakdown = await expandTargets(client, actor.tenantId, requestId, input.targets);
    const expandedCount =
      breakdown.user + breakdown.org_unit + breakdown.group + breakdown.all;

    if (expandedCount === 0) {
      throw new CreateRequestError('no targets expanded', 'empty_expansion');
    }

    // Emit notifications for each assignee
    const { rows: asgRows } = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM assignment WHERE request_id = $1`,
      [requestId],
    );
    for (const a of asgRows) {
      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: a.user_id,
        requestId,
        assignmentId: a.id,
        kind: 'created',
        payload: { title: input.title },
      });
    }

    // Audit
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'request.created', 'request', $3, $4::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        requestId,
        JSON.stringify({ expandedCount, breakdown }),
      ],
    );

    return { id: requestId, expandedCount, breakdown };
  });
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/create.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/create.ts tests/unit/domain/request/create.test.ts
git commit -m "feat(domain): createRequest orchestration (permissions + expand + notify)"
```

---

## Task 9: Assignment permissions — isManagerOf + canSubstitute

**Files:**
- Create: `src/domain/assignment/permissions.ts`
- Test: `tests/unit/domain/assignment/permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/assignment/permissions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import {
  isManagerOf,
  canSubstitute,
} from '../../../../src/domain/assignment/permissions.js';

describe('assignment permissions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('isManagerOf: manager of orgDiv is manager of memberA (in orgTeam, descendant)', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      isManagerOf(c, s.users.manager, s.users.memberA),
    );
    expect(ok).toBe(true);
  });

  it('isManagerOf: memberB is not manager of memberA', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      isManagerOf(c, s.users.memberB, s.users.memberA),
    );
    expect(ok).toBe(false);
  });

  it('isManagerOf: manager is NOT manager of outsider (different subtree)', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      isManagerOf(c, s.users.manager, s.users.outsider),
    );
    expect(ok).toBe(false);
  });

  it('canSubstitute: requester can substitute assignee', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      canSubstitute(c, { requesterId: s.users.admin, assigneeId: s.users.memberA }, s.users.admin),
    );
    expect(ok).toBe(true);
  });

  it('canSubstitute: manager of assignee can substitute', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      canSubstitute(c, { requesterId: s.users.admin, assigneeId: s.users.memberA }, s.users.manager),
    );
    expect(ok).toBe(true);
  });

  it('canSubstitute: random user cannot substitute', async () => {
    const s = await createDomainScenario(getPool());
    const ok = await withTenant(getAppPool(), s.tenantId, async (c) =>
      canSubstitute(c, { requesterId: s.users.admin, assigneeId: s.users.memberA }, s.users.outsider),
    );
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/permissions.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/assignment/permissions.ts
import type pg from 'pg';

/**
 * `actor` is a manager of `subject` iff actor is listed in `org_unit_manager`
 * for an org_unit that is an ancestor (closure) of any org_unit the subject
 * belongs to.
 */
export async function isManagerOf(
  client: pg.PoolClient,
  actorUserId: string,
  subjectUserId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM user_org_unit subj
         JOIN org_unit_closure c ON c.descendant_id = subj.org_unit_id
         JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
        WHERE subj.user_id = $1
          AND m.user_id = $2
     ) AS ok`,
    [subjectUserId, actorUserId],
  );
  return rows[0].ok;
}

export type SubstituteContext = {
  requesterId: string;
  assigneeId: string;
};

/**
 * Substitution permission:
 *   actor === requester  OR  actor is a manager of the assignee.
 * Spec: "依頼者 or 対象者の上長".
 */
export async function canSubstitute(
  client: pg.PoolClient,
  ctx: SubstituteContext,
  actorUserId: string,
): Promise<boolean> {
  if (actorUserId === ctx.requesterId) return true;
  return isManagerOf(client, actorUserId, ctx.assigneeId);
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/permissions.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/assignment/permissions.ts tests/unit/domain/assignment/permissions.test.ts
git commit -m "feat(domain): isManagerOf + canSubstitute via org_unit_manager closure"
```

---

## Task 10: Assignment actions — open/respond/unavailable/forward/substitute/exempt

**Files:**
- Create: `src/domain/assignment/actions.ts`
- Test: `tests/unit/domain/assignment/actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/assignment/actions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { withTenant } from '../../../../src/db/with-tenant.js';
import {
  openAssignment,
  respondAssignment,
  unavailableAssignment,
  forwardAssignment,
  substituteAssignment,
  exemptAssignment,
  AssignmentActionError,
} from '../../../../src/domain/assignment/actions.js';
import type { ActorContext } from '../../../../src/domain/types.js';

async function seedAssignment(
  s: Awaited<ReturnType<typeof createDomainScenario>>,
  userId: string,
): Promise<{ requestId: string; assignmentId: string }> {
  const pool = getPool();
  const requestId = randomUUID();
  await pool.query(
    `INSERT INTO request(id, tenant_id, created_by_user_id, type, title, status)
     VALUES ($1,$2,$3,'task','t','active')`,
    [requestId, s.tenantId, s.users.admin],
  );
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assignment(tenant_id, request_id, user_id)
     VALUES ($1,$2,$3) RETURNING id`,
    [s.tenantId, requestId, userId],
  );
  return { requestId, assignmentId: rows[0].id };
}

function ctx(s: { tenantId: string }, userId: string, opts: Partial<ActorContext> = {}): ActorContext {
  return {
    userId, tenantId: s.tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('assignment actions', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('openAssignment transitions unopened → opened and sets action_at', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await openAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId);
    const { rows } = await getPool().query(
      `SELECT status, opened_at, action_at FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('opened');
    expect(rows[0].opened_at).not.toBeNull();
    expect(rows[0].action_at).not.toBeNull();
  });

  it('respondAssignment unopened → responded with history row', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, { note: 'done' });
    const { rows } = await getPool().query(
      `SELECT status, responded_at FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('responded');
    const { rows: h } = await getPool().query(
      `SELECT transition_kind, reason FROM assignment_status_history
        WHERE assignment_id=$1 ORDER BY created_at`,
      [assignmentId],
    );
    expect(h[0].transition_kind).toBe('user_respond');
  });

  it('unavailableAssignment requires reason', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      unavailableAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: '' }),
    ).rejects.toBeInstanceOf(AssignmentActionError);
  });

  it('forwardAssignment creates new assignment linked via forwarded_from_assignment_id', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentId } = await seedAssignment(s, s.users.memberA);
    const result = await forwardAssignment(
      getAppPool(), ctx(s, s.users.memberA), assignmentId,
      { toUserId: s.users.memberB, reason: 'over capacity' },
    );
    expect(result.newAssignmentId).toBeDefined();
    const { rows } = await getPool().query(
      `SELECT id, user_id, status, forwarded_from_assignment_id
         FROM assignment WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('forwarded');
    expect(rows[1].user_id).toBe(s.users.memberB);
    expect(rows[1].status).toBe('unopened');
    expect(rows[1].forwarded_from_assignment_id).toBe(assignmentId);
  });

  it('forwardAssignment rejects if target already has assignment for this request', async () => {
    const s = await createDomainScenario(getPool());
    const { requestId, assignmentId } = await seedAssignment(s, s.users.memberA);
    await getPool().query(
      `INSERT INTO assignment(tenant_id, request_id, user_id)
       VALUES ($1,$2,$3)`,
      [s.tenantId, requestId, s.users.memberB],
    );
    await expect(
      forwardAssignment(
        getAppPool(), ctx(s, s.users.memberA), assignmentId,
        { toUserId: s.users.memberB, reason: 'x' },
      ),
    ).rejects.toThrow(/already has assignment/);
  });

  it('substituteAssignment by requester succeeds', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await substituteAssignment(
      getAppPool(), ctx(s, s.users.admin),
      assignmentId, { reason: 'on behalf' },
    );
    const { rows } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('substituted');
  });

  it('substituteAssignment by non-requester non-manager rejected', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      substituteAssignment(
        getAppPool(), ctx(s, s.users.outsider), assignmentId, { reason: 'x' },
      ),
    ).rejects.toBeInstanceOf(AssignmentActionError);
  });

  it('exemptAssignment requires tenant_admin role', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await expect(
      exemptAssignment(
        getAppPool(), ctx(s, s.users.memberA), assignmentId, { reason: 'x' },
      ),
    ).rejects.toBeInstanceOf(AssignmentActionError);
    // admin succeeds
    await exemptAssignment(
      getAppPool(), ctx(s, s.users.admin, { isTenantAdmin: true }),
      assignmentId, { reason: 'duplicate' },
    );
    const { rows } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('exempted');
  });

  it('terminal status is irreversible', async () => {
    const s = await createDomainScenario(getPool());
    const { assignmentId } = await seedAssignment(s, s.users.memberA);
    await respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, {});
    await expect(
      respondAssignment(getAppPool(), ctx(s, s.users.memberA), assignmentId, {}),
    ).rejects.toBeInstanceOf(AssignmentActionError);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/actions.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/assignment/actions.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext, AssignmentStatus } from '../types.js';
import { canTransition } from './transitions.js';
import { canSubstitute } from './permissions.js';
import { emitNotification } from '../notification/emit.js';

export class AssignmentActionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'permission_denied'
      | 'invalid_transition'
      | 'validation'
      | 'conflict',
  ) {
    super(message);
    this.name = 'AssignmentActionError';
  }
}

type AssignmentRow = {
  id: string;
  request_id: string;
  user_id: string;
  status: AssignmentStatus;
  created_by_user_id: string;
};

async function loadLocked(
  client: pg.PoolClient,
  assignmentId: string,
): Promise<AssignmentRow> {
  const { rows } = await client.query<AssignmentRow>(
    `SELECT a.id, a.request_id, a.user_id, a.status::text AS status,
            r.created_by_user_id
       FROM assignment a
       JOIN request r ON r.id = a.request_id
      WHERE a.id = $1
      FOR UPDATE OF a`,
    [assignmentId],
  );
  if (rows.length === 0) {
    throw new AssignmentActionError('assignment not found', 'not_found');
  }
  return rows[0];
}

async function recordHistory(
  client: pg.PoolClient,
  tenantId: string,
  asg: AssignmentRow,
  to: AssignmentStatus,
  transitionKind: string,
  actorUserId: string,
  reason: string | null,
  forwardedToUserId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO assignment_status_history
       (tenant_id, assignment_id, from_status, to_status, transition_kind,
        transitioned_by_user_id, reason, forwarded_to_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenantId, asg.id, asg.status, to, transitionKind, actorUserId, reason, forwardedToUserId],
  );
}

export async function openAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (asg.status !== 'unopened') return; // idempotent: no-op when already opened or terminal
    if (!canTransition({ from: asg.status, to: 'opened', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot open', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='opened', opened_at=now(), action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(client, actor.tenantId, asg, 'opened', 'auto_open', actor.userId, null, null);
  });
}

export async function respondAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { note?: string },
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (!canTransition({ from: asg.status, to: 'responded', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot respond', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='responded', responded_at=now(), action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'responded', 'user_respond',
      actor.userId, input.note ?? null, null,
    );
  });
}

export async function unavailableAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { reason: string },
): Promise<void> {
  if (!input.reason?.trim()) {
    throw new AssignmentActionError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (!canTransition({ from: asg.status, to: 'unavailable', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot mark unavailable', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment
          SET status='unavailable', action_at=now()
        WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'unavailable', 'user_unavailable',
      actor.userId, input.reason, null,
    );
  });
}

export async function forwardAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { toUserId: string; reason?: string },
): Promise<{ newAssignmentId: string }> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (asg.user_id !== actor.userId) {
      throw new AssignmentActionError('not assignee', 'permission_denied');
    }
    if (!canTransition({ from: asg.status, to: 'forwarded', actorRole: 'assignee' })) {
      throw new AssignmentActionError('cannot forward', 'invalid_transition');
    }
    // Duplicate-check: target must not already have an assignment for this request
    const { rows: dup } = await client.query(
      `SELECT 1 FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [asg.request_id, input.toUserId],
    );
    if (dup.length > 0) {
      throw new AssignmentActionError(
        `target user already has assignment for this request`,
        'conflict',
      );
    }
    await client.query(
      `UPDATE assignment SET status='forwarded', action_at=now() WHERE id=$1`,
      [assignmentId],
    );
    const { rows: newRows } = await client.query<{ id: string }>(
      `INSERT INTO assignment
         (tenant_id, request_id, user_id, forwarded_from_assignment_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [actor.tenantId, asg.request_id, input.toUserId, asg.id],
    );
    const newAssignmentId = newRows[0].id;
    await recordHistory(
      client, actor.tenantId, asg, 'forwarded', 'user_forward',
      actor.userId, input.reason ?? null, input.toUserId,
    );
    await emitNotification(client, {
      tenantId: actor.tenantId,
      recipientUserId: input.toUserId,
      requestId: asg.request_id,
      assignmentId: newAssignmentId,
      kind: 'created',
      payload: { forwardedFrom: actor.userId },
    });
    return { newAssignmentId };
  });
}

export async function substituteAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { reason: string },
): Promise<void> {
  if (!input.reason?.trim()) {
    throw new AssignmentActionError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    const allowed = await canSubstitute(
      client,
      { requesterId: asg.created_by_user_id, assigneeId: asg.user_id },
      actor.userId,
    );
    if (!allowed) {
      throw new AssignmentActionError('not permitted to substitute', 'permission_denied');
    }
    const actorRole = actor.userId === asg.created_by_user_id ? 'requester' : 'manager';
    if (!canTransition({ from: asg.status, to: 'substituted', actorRole })) {
      throw new AssignmentActionError('cannot substitute', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment SET status='substituted', action_at=now() WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'substituted', 'manager_substitute',
      actor.userId, input.reason, null,
    );
    // Notify assignee if someone else completed on their behalf
    if (actor.userId !== asg.user_id) {
      await emitNotification(client, {
        tenantId: actor.tenantId,
        recipientUserId: asg.user_id,
        requestId: asg.request_id,
        assignmentId: asg.id,
        kind: 'completed',
        payload: { substitutedBy: actor.userId, reason: input.reason },
      });
    }
  });
}

export async function exemptAssignment(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
  input: { reason: string },
): Promise<void> {
  if (!actor.isTenantAdmin) {
    throw new AssignmentActionError('tenant_admin required', 'permission_denied');
  }
  if (!input.reason?.trim()) {
    throw new AssignmentActionError('reason required', 'validation');
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    const asg = await loadLocked(client, assignmentId);
    if (!canTransition({ from: asg.status, to: 'exempted', actorRole: 'tenant_admin' })) {
      throw new AssignmentActionError('cannot exempt', 'invalid_transition');
    }
    await client.query(
      `UPDATE assignment SET status='exempted', action_at=now() WHERE id=$1`,
      [assignmentId],
    );
    await recordHistory(
      client, actor.tenantId, asg, 'exempted', 'admin_exempt',
      actor.userId, input.reason, null,
    );
  });
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/assignment/actions.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/assignment/actions.ts tests/unit/domain/assignment/actions.test.ts
git commit -m "feat(domain): assignment actions (open/respond/unavailable/forward/substitute/exempt)"
```

---

## Task 11: Request list with scope filter

**Files:**
- Create: `src/domain/request/list.ts`
- Test: `tests/unit/domain/request/list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/domain/request/list.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, stopTestDb, getAppPool, getPool } from '../../../helpers/pg-container.js';
import { createDomainScenario } from '../../../helpers/fixtures/domain-scenario.js';
import { createRequest } from '../../../../src/domain/request/create.js';
import { listRequests, ListRequestsError } from '../../../../src/domain/request/list.js';
import type { ActorContext } from '../../../../src/domain/types.js';

function ctx(
  tenantId: string, userId: string, opts: Partial<ActorContext> = {},
): ActorContext {
  return {
    userId, tenantId,
    isTenantAdmin: false, isTenantWideRequester: false, ...opts,
  };
}

describe('listRequests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('scope=mine returns requests I created or am assignee of', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    // admin creates a request to memberA
    await createRequest(getAppPool(), adminCtx, {
      title: 'R1', body: '', dueAt: new Date().toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    // memberA sees it via mine (assignee)
    const memberCtx = ctx(s.tenantId, s.users.memberA);
    const result = await listRequests(getAppPool(), memberCtx, { scope: 'mine' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('R1');
  });

  it('scope=subordinate returns requests where assignee is in managed subtree', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    await createRequest(getAppPool(), adminCtx, {
      title: 'R2', body: '', dueAt: new Date().toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const managerCtx = ctx(s.tenantId, s.users.manager);
    const result = await listRequests(getAppPool(), managerCtx, { scope: 'subordinate' });
    expect(result.items.map((r) => r.title)).toContain('R2');
  });

  it('scope=subordinate for non-manager returns empty (not error)', async () => {
    const s = await createDomainScenario(getPool());
    const memberCtx = ctx(s.tenantId, s.users.memberB);
    const result = await listRequests(getAppPool(), memberCtx, { scope: 'subordinate' });
    expect(result.items).toEqual([]);
  });

  it('scope=all without tenant_wide_requester → error', async () => {
    const s = await createDomainScenario(getPool());
    const memberCtx = ctx(s.tenantId, s.users.memberA);
    await expect(
      listRequests(getAppPool(), memberCtx, { scope: 'all' }),
    ).rejects.toBeInstanceOf(ListRequestsError);
  });

  it('scope=all with tenant_wide_requester returns tenant-wide', async () => {
    const s = await createDomainScenario(getPool());
    const adminCtx = ctx(s.tenantId, s.users.admin, { isTenantAdmin: true });
    await createRequest(getAppPool(), adminCtx, {
      title: 'R3', body: '', dueAt: new Date().toISOString(),
      type: 'task',
      targets: [{ type: 'user', userId: s.users.memberA }],
    });
    const wideCtx = ctx(s.tenantId, s.users.wideReq, { isTenantWideRequester: true });
    const result = await listRequests(getAppPool(), wideCtx, { scope: 'all' });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify FAIL**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/list.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/request/list.ts
import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext } from '../types.js';

export type ListScope = 'mine' | 'subordinate' | 'all';

export type ListRequestsInput = {
  scope: ListScope;
  page?: number;
  pageSize?: number;
};

export type RequestListItem = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  createdByUserId: string;
};

export type ListRequestsResult = {
  items: RequestListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export class ListRequestsError extends Error {
  constructor(msg: string, readonly code: 'permission_denied' | 'validation') {
    super(msg);
    this.name = 'ListRequestsError';
  }
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function listRequests(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListRequestsInput,
): Promise<ListRequestsResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  if (input.scope === 'all' && !(actor.isTenantWideRequester || actor.isTenantAdmin)) {
    throw new ListRequestsError('scope=all requires tenant-wide permission', 'permission_denied');
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    let where = '';
    const params: unknown[] = [];

    if (input.scope === 'mine') {
      params.push(actor.userId);
      where = `WHERE (r.created_by_user_id = $1
                  OR EXISTS (SELECT 1 FROM assignment a
                              WHERE a.request_id = r.id AND a.user_id = $1))`;
    } else if (input.scope === 'subordinate') {
      // requests where assignee is in a subtree managed by actor
      params.push(actor.userId);
      where = `WHERE EXISTS (
                 SELECT 1
                   FROM assignment a
                   JOIN user_org_unit uou ON uou.user_id = a.user_id
                   JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
                   JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
                  WHERE a.request_id = r.id AND m.user_id = $1
               )`;
    }
    // scope=all: no WHERE; RLS enforces tenant isolation

    const countSql = `SELECT COUNT(*)::int AS n FROM request r ${where}`;
    const { rows: countRows } = await client.query<{ n: number }>(countSql, params);
    const total = countRows[0].n;

    params.push(pageSize, offset);
    const itemSql = `
      SELECT r.id, r.title, r.type, r.status,
             r.due_at, r.created_at, r.created_by_user_id
        FROM request r
        ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await client.query(itemSql, params);

    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        status: r.status,
        dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        createdByUserId: r.created_by_user_id,
      })),
      total,
      page,
      pageSize,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify PASS**

Run: `corepack pnpm@9.12.0 vitest run tests/unit/domain/request/list.test.ts`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add src/domain/request/list.ts tests/unit/domain/request/list.test.ts
git commit -m "feat(domain): listRequests with mine/subordinate/all scope"
```

---

## Task 12: Route handlers + session guard

**Files:**
- Create: `app/t/[code]/api/_lib/session-guard.ts`
- Create: `app/t/[code]/api/requests/route.ts`
- Create: `app/t/[code]/api/requests/[id]/route.ts`
- Create: `app/t/[code]/api/assignments/route.ts`
- Create: `app/t/[code]/api/assignments/[id]/route.ts`

- [ ] **Step 1: Create session guard helper**

```ts
// app/t/[code]/api/_lib/session-guard.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminPool, appPool } from '@/db/pools';
import { resolveTenant } from '@/tenant/resolver';
import { unsealSession } from '@/auth/session';
import { loadConfig } from '@/config';
import { withTenant } from '@/db/with-tenant';
import type { ActorContext } from '@/domain/types';

export type GuardedContext = {
  tenantId: string;
  tenantCode: string;
  actor: ActorContext;
};

export async function requireSession(
  req: NextRequest,
  code: string,
): Promise<GuardedContext | NextResponse> {
  const tenant = await resolveTenant(adminPool(), code);
  if (!tenant) return new NextResponse('Tenant not found', { status: 404 });

  const cfg = loadConfig();
  const sealed = req.cookies.get('nudge_session')?.value;
  const session = await unsealSession(sealed, cfg.IRON_SESSION_PASSWORD);
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  if (session.tenantId !== tenant.id) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Load role flags once per request
  const flags = await withTenant(appPool(), tenant.id, async (client) => {
    const { rows } = await client.query<{ role: string }>(
      `SELECT role FROM user_role WHERE user_id = $1`,
      [session.userId],
    );
    const roles = new Set(rows.map((r) => r.role));
    return {
      isTenantAdmin: roles.has('tenant_admin'),
      isTenantWideRequester: roles.has('tenant_wide_requester'),
    };
  });

  return {
    tenantId: tenant.id,
    tenantCode: tenant.code,
    actor: {
      userId: session.userId,
      tenantId: tenant.id,
      ...flags,
    },
  };
}

export function isGuardFailure(x: unknown): x is NextResponse {
  return x instanceof NextResponse;
}
```

- [ ] **Step 2: Create `requests/route.ts` (POST + GET)**

```ts
// app/t/[code]/api/requests/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { createRequest, CreateRequestError } from '@/domain/request/create';
import { listRequests, ListRequestsError, type ListScope } from '@/domain/request/list';

export const runtime = 'nodejs';

export async function POST(
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
  const b = body as {
    title?: string; body?: string; dueAt?: string;
    type?: 'survey' | 'task';
    targets?: unknown[];
  };
  if (!b.title || !b.type || !Array.isArray(b.targets)) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    const result = await createRequest(appPool(), guard.actor, {
      title: b.title,
      body: b.body ?? '',
      dueAt: b.dueAt ?? new Date().toISOString(),
      type: b.type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      targets: b.targets as any,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CreateRequestError) {
      const status = err.code === 'permission_denied' ? 403 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const url = req.nextUrl;
  const scope = (url.searchParams.get('scope') ?? 'mine') as ListScope;
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? '50');
  if (!['mine', 'subordinate', 'all'].includes(scope)) {
    return NextResponse.json({ error: 'invalid scope' }, { status: 400 });
  }

  try {
    const result = await listRequests(appPool(), guard.actor, { scope, page, pageSize });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ListRequestsError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }
}
```

- [ ] **Step 3: Create `requests/[id]/route.ts` (GET detail)**

```ts
// app/t/[code]/api/requests/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import { withTenant } from '@/db/with-tenant';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  return withTenant(appPool(), guard.tenantId, async (client) => {
    const { rows: reqRows } = await client.query(
      `SELECT id, title, body, type, status, due_at, created_at, created_by_user_id
         FROM request WHERE id=$1`,
      [id],
    );
    if (reqRows.length === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const r = reqRows[0];

    // Authorization: creator, assignee, tenant_wide_requester, tenant_admin,
    // or manager of an assignee in subtree
    const isCreator = r.created_by_user_id === guard.actor.userId;
    const { rows: asgSelf } = await client.query(
      `SELECT id FROM assignment WHERE request_id=$1 AND user_id=$2`,
      [id, guard.actor.userId],
    );
    const isAssignee = asgSelf.length > 0;
    const isWide = guard.actor.isTenantAdmin || guard.actor.isTenantWideRequester;
    let isSubordinateManager = false;
    if (!isCreator && !isAssignee && !isWide) {
      const { rows: mgr } = await client.query(
        `SELECT 1 FROM assignment a
           JOIN user_org_unit uou ON uou.user_id = a.user_id
           JOIN org_unit_closure c ON c.descendant_id = uou.org_unit_id
           JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
          WHERE a.request_id=$1 AND m.user_id=$2 LIMIT 1`,
        [id, guard.actor.userId],
      );
      isSubordinateManager = mgr.length > 0;
    }
    if (!(isCreator || isAssignee || isWide || isSubordinateManager)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    // my assignment (if any)
    let myAssignment: { id: string; status: string; isOverdue: boolean } | null = null;
    if (asgSelf.length > 0) {
      const { rows } = await client.query(
        `SELECT a.id, a.status, (r.due_at IS NOT NULL AND r.due_at < now()
                                 AND a.status IN ('unopened','opened')) AS overdue
           FROM assignment a JOIN request r ON r.id = a.request_id
          WHERE a.id=$1`,
        [asgSelf[0].id],
      );
      myAssignment = {
        id: rows[0].id,
        status: rows[0].status,
        isOverdue: rows[0].overdue,
      };
    }

    return NextResponse.json({
      id: r.id,
      title: r.title,
      body: r.body,
      type: r.type,
      status: r.status,
      dueAt: r.due_at,
      createdAt: r.created_at,
      createdByUserId: r.created_by_user_id,
      myAssignment,
    });
  });
}
```

- [ ] **Step 4: Create `assignments/route.ts` (GET list)**

```ts
// app/t/[code]/api/assignments/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../_lib/session-guard';
import { withTenant } from '@/db/with-tenant';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  const statusFilter = req.nextUrl.searchParams.get('status') ?? 'pending';
  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('pageSize') ?? '50')));

  const statusSql =
    statusFilter === 'done'
      ? `a.status IN ('responded','unavailable','forwarded','substituted','exempted','expired')`
      : `a.status IN ('unopened','opened')`;

  return withTenant(appPool(), guard.tenantId, async (client) => {
    const { rows: countRows } = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.user_id = $1 AND ${statusSql}`,
      [guard.actor.userId],
    );
    const total = countRows[0].n;
    const { rows } = await client.query(
      `SELECT a.id, a.status, a.opened_at, a.responded_at, a.action_at,
              r.id AS request_id, r.title, r.due_at,
              (r.due_at IS NOT NULL AND r.due_at < now()
               AND a.status IN ('unopened','opened')) AS is_overdue
         FROM assignment a
         JOIN request r ON r.id = a.request_id
        WHERE a.user_id = $1 AND ${statusSql}
        ORDER BY r.due_at ASC NULLS LAST, a.created_at DESC
        LIMIT $2 OFFSET $3`,
      [guard.actor.userId, pageSize, (page - 1) * pageSize],
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        openedAt: r.opened_at,
        respondedAt: r.responded_at,
        actionAt: r.action_at,
        request: { id: r.request_id, title: r.title, dueAt: r.due_at },
        isOverdue: r.is_overdue,
      })),
      total, page, pageSize,
    });
  });
}
```

- [ ] **Step 5: Create `assignments/[id]/route.ts` (PATCH dispatcher)**

```ts
// app/t/[code]/api/assignments/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { appPool } from '@/db/pools';
import { requireSession, isGuardFailure } from '../../_lib/session-guard';
import {
  openAssignment,
  respondAssignment,
  unavailableAssignment,
  forwardAssignment,
  substituteAssignment,
  exemptAssignment,
  AssignmentActionError,
} from '@/domain/assignment/actions';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const guard = await requireSession(req, code);
  if (isGuardFailure(guard)) return guard;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const b = body as {
    action?: string;
    toUserId?: string;
    reason?: string;
    note?: string;
  };
  if (!b.action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 });
  }

  try {
    let payload: unknown = { ok: true };
    switch (b.action) {
      case 'open':
        await openAssignment(appPool(), guard.actor, id); break;
      case 'respond':
        await respondAssignment(appPool(), guard.actor, id, { note: b.note }); break;
      case 'unavailable':
        await unavailableAssignment(appPool(), guard.actor, id, { reason: b.reason ?? '' }); break;
      case 'forward':
        if (!b.toUserId) {
          return NextResponse.json({ error: 'toUserId required' }, { status: 400 });
        }
        payload = await forwardAssignment(
          appPool(), guard.actor, id,
          { toUserId: b.toUserId, reason: b.reason },
        );
        break;
      case 'substitute':
        await substituteAssignment(appPool(), guard.actor, id, { reason: b.reason ?? '' }); break;
      case 'exempt':
        await exemptAssignment(appPool(), guard.actor, id, { reason: b.reason ?? '' }); break;
      default:
        return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof AssignmentActionError) {
      const status =
        err.code === 'not_found' ? 404 :
        err.code === 'permission_denied' ? 403 :
        err.code === 'conflict' ? 409 : 400;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
}
```

- [ ] **Step 6: Typecheck**

Run: `corepack pnpm@9.12.0 exec tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add app/t/[code]/api/ src/domain/
git commit -m "feat(api): REST handlers for requests and assignments"
```

---

## Task 13: Integration tests (REST end-to-end)

These tests start Next.js route handlers against a real DB via a thin test driver. Since there is no HTTP server in unit tests, we import the handlers directly and invoke them with a fabricated `NextRequest`. The `nudge_session` cookie is produced via `sealSession()` so the guard code path is exercised authentically.

**Files:**
- Create: `tests/helpers/session-cookie.ts`
- Create: `tests/integration/request-create-flow.test.ts`
- Create: `tests/integration/assignment-status-flow.test.ts`
- Create: `tests/integration/assignment-forward.test.ts`
- Create: `tests/integration/assignment-substitute.test.ts`
- Create: `tests/integration/request-list-scope.test.ts`

- [ ] **Step 1: Session cookie helper**

```ts
// tests/helpers/session-cookie.ts
import { sealSession, type NudgeSession } from '../../src/auth/session.js';
import { loadConfig } from '../../src/config.js';

export async function makeSessionCookie(
  overrides: Partial<NudgeSession> & { userId: string; tenantId: string; tenantCode: string },
): Promise<string> {
  const sess: NudgeSession = {
    userId: overrides.userId,
    tenantId: overrides.tenantId,
    tenantCode: overrides.tenantCode,
    sub: 'kc-' + overrides.userId,
    email: overrides.email ?? 'test@test',
    displayName: overrides.displayName ?? 'Test',
    refreshToken: '',
    accessTokenExp: Math.floor(Date.now() / 1000) + 3600,
  };
  const cfg = loadConfig();
  const sealed = await sealSession(sess, cfg.IRON_SESSION_PASSWORD);
  return `nudge_session=${sealed}`;
}
```

- [ ] **Step 2: request-create-flow integration test**

```ts
// tests/integration/request-create-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST } from '../../app/t/[code]/api/requests/route.js';

describe('POST /t/:code/api/requests', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('creates a request and returns 201', async () => {
    const s = await createDomainScenario(getPool());
    const cookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const req = new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        title: 'Integration R',
        type: 'task',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: s.users.memberA }],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: s.tenantCode }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.expandedCount).toBe(1);

    const { rows } = await getPool().query(
      `SELECT title FROM request WHERE id=$1`,
      [body.id],
    );
    expect(rows[0].title).toBe('Integration R');
  });
});
```

- [ ] **Step 3: assignment-status-flow integration test**

```ts
// tests/integration/assignment-status-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH } from '../../app/t/[code]/api/assignments/[id]/route.js';

describe('assignment status flow', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('unopened -> opened -> responded via REST', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const createReqObj = new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        title: 'Flow', type: 'task',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: s.users.memberA }],
      }),
    });
    const res = await createReq(createReqObj, { params: Promise.resolve({ code: s.tenantCode }) });
    expect(res.status).toBe(201);
    const { id: requestId } = await res.json();

    const { rows: asg } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = asg[0].id;

    const patch = (action: string, body: Record<string, unknown> = {}) =>
      PATCH(
        new NextRequest(
          `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json', cookie: memberCookie },
            body: JSON.stringify({ action, ...body }),
          },
        ),
        { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
      );

    expect((await patch('open')).status).toBe(200);
    expect((await patch('respond', { note: 'done' })).status).toBe(200);

    const { rows } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(rows[0].status).toBe('responded');
  });
});
```

- [ ] **Step 4: assignment-forward integration test**

```ts
// tests/integration/assignment-forward.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH } from '../../app/t/[code]/api/assignments/[id]/route.js';

describe('forward via REST', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('forwards to memberB, status=forwarded, new assignment created', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const aCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const createRes = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Fwd', type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await createRes.json();
    const { rows: asg } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = asg[0].id;

    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: aCookie },
          body: JSON.stringify({ action: 'forward', toUserId: s.users.memberB, reason: 'busy' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(200);

    const { rows } = await getPool().query(
      `SELECT user_id, status, forwarded_from_assignment_id
         FROM assignment WHERE request_id=$1 ORDER BY created_at`,
      [requestId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('forwarded');
    expect(rows[1].user_id).toBe(s.users.memberB);
    expect(rows[1].forwarded_from_assignment_id).toBe(assignmentId);
  });
});
```

- [ ] **Step 5: assignment-substitute integration test**

```ts
// tests/integration/assignment-substitute.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { PATCH } from '../../app/t/[code]/api/assignments/[id]/route.js';

async function seedOne(tenantCode: string, adminId: string, memberA: string, tenantId: string) {
  const adminCookie = await makeSessionCookie({
    userId: adminId, tenantId, tenantCode,
  });
  const res = await createReq(
    new NextRequest(`http://localhost/t/${tenantCode}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        title: 'Sub', type: 'task',
        dueAt: new Date(Date.now() + 86400000).toISOString(),
        targets: [{ type: 'user', userId: memberA }],
      }),
    }),
    { params: Promise.resolve({ code: tenantCode }) },
  );
  return (await res.json()).id as string;
}

describe('substitute via REST', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('requester can substitute', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.admin, s.users.memberA, s.tenantId);
    const { rows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = rows[0].id;

    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: adminCookie },
          body: JSON.stringify({ action: 'substitute', reason: 'on behalf' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(200);
    const { rows: r2 } = await getPool().query(
      `SELECT status FROM assignment WHERE id=$1`,
      [assignmentId],
    );
    expect(r2[0].status).toBe('substituted');
  });

  it('outsider rejected with 403', async () => {
    const s = await createDomainScenario(getPool());
    const requestId = await seedOne(s.tenantCode, s.users.admin, s.users.memberA, s.tenantId);
    const { rows } = await getPool().query(
      `SELECT id FROM assignment WHERE request_id=$1`,
      [requestId],
    );
    const assignmentId = rows[0].id;

    const outsiderCookie = await makeSessionCookie({
      userId: s.users.outsider, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await PATCH(
      new NextRequest(
        `http://localhost/t/${s.tenantCode}/api/assignments/${assignmentId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: outsiderCookie },
          body: JSON.stringify({ action: 'substitute', reason: 'x' }),
        },
      ),
      { params: Promise.resolve({ code: s.tenantCode, id: assignmentId }) },
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: request-list-scope integration test**

```ts
// tests/integration/request-list-scope.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import { POST, GET } from '../../app/t/[code]/api/requests/route.js';

describe('GET /t/:code/api/requests?scope=...', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('mine returns only requests for the assignee', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    await POST(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'Mine', type: 'task',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests?scope=mine`, {
        method: 'GET',
        headers: { cookie: memberCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { title: string }) => i.title)).toContain('Mine');
  });

  it('scope=all without wide_requester → 403', async () => {
    const s = await createDomainScenario(getPool());
    const memberCookie = await makeSessionCookie({
      userId: s.users.memberA, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const res = await GET(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests?scope=all`, {
        method: 'GET',
        headers: { cookie: memberCookie },
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 7: Run all integration tests**

Run: `corepack pnpm@9.12.0 vitest run tests/integration/request-create-flow.test.ts tests/integration/assignment-status-flow.test.ts tests/integration/assignment-forward.test.ts tests/integration/assignment-substitute.test.ts tests/integration/request-list-scope.test.ts`
Expected: all passed

- [ ] **Step 8: Run the full test suite**

Run: `corepack pnpm@9.12.0 run test:all`
Expected: all passed, no regressions from v0.1–v0.4

- [ ] **Step 9: Commit**

```bash
git add tests/helpers/session-cookie.ts tests/integration/request-create-flow.test.ts tests/integration/assignment-status-flow.test.ts tests/integration/assignment-forward.test.ts tests/integration/assignment-substitute.test.ts tests/integration/request-list-scope.test.ts
git commit -m "test(integration): v0.5 REST end-to-end flows (create/status/forward/substitute/list)"
```

---

## Final Verification

- [ ] **Run full suite**

```bash
corepack pnpm@9.12.0 run test:all
corepack pnpm@9.12.0 exec tsc --noEmit
```

Expected: green

- [ ] **Merge feature branch**

```bash
git checkout main
git merge --no-ff feat/v05-domain-logic -m "Merge branch 'feat/v05-domain-logic': v0.5 Domain Logic"
```
