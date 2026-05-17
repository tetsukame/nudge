import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { startTestDb, stopTestDb, getPool } from '../helpers/pg-container.js';
import { createDomainScenario } from '../helpers/fixtures/domain-scenario.js';
import { POST as createReq } from '../../app/t/[code]/api/requests/route.js';
import { makeSessionCookie } from '../helpers/session-cookie.js';
import {
  getRequestForCopy,
  CopySourceError,
} from '../../src/domain/request/get-for-copy.js';

describe('NDG-43 getRequestForCopy', () => {
  beforeAll(async () => { await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('returns prefill values for the original requester', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: '月次レポート',
          body: '今月の集計をお願いします',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          estimatedMinutes: 30,
          targets: [
            { type: 'user', userId: s.users.memberA },
            { type: 'group', groupId: s.groupId },
            { type: 'org_unit', orgUnitId: s.orgTeam, includeDescendants: false },
          ],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();

    const result = await getRequestForCopy(
      getPool(),
      {
        userId: s.users.admin,
        tenantId: s.tenantId,
        isTenantAdmin: true,
        isTenantWideRequester: false,
      },
      requestId,
    );

    expect(result.title).toBe('月次レポート');
    expect(result.body).toBe('今月の集計をお願いします');
    expect(result.estimatedMinutes).toBe(30);

    // targets should be reconstructed; no due_at carried over
    const types = result.targets.map((t) => t.type).sort();
    expect(types).toEqual(['group', 'org_unit', 'user']);
    const userTarget = result.targets.find((t) => t.type === 'user');
    expect(userTarget && (userTarget as { userId: string }).userId).toBe(
      s.users.memberA,
    );
    const groupTarget = result.targets.find((t) => t.type === 'group');
    expect(groupTarget && (groupTarget as { groupId: string }).groupId).toBe(
      s.groupId,
    );

    // NDG-50: org/user display names must be resolvable for copy prefill
    expect(result.orgMeta[s.orgTeam]).toBe('Team');
    expect(result.userMeta[s.users.memberA]).toMatchObject({
      id: s.users.memberA,
      displayName: 'a@test',
    });
    expect(result.droppedTargets).toEqual([]);
  });

  it('drops targets whose referenced org/user no longer exists and reports them', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });

    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'stale targets',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [
            { type: 'user', userId: s.users.memberA },
            { type: 'org_unit', orgUnitId: s.orgTeam, includeDescendants: false },
          ],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();

    // Orphan the org_unit target by repointing it to a non-existent id,
    // and deactivate the user target.
    await getPool().query(
      `UPDATE request_target SET target_id = '00000000-0000-0000-0000-0000000000ff'
        WHERE request_id = $1 AND target_type = 'org_unit'`,
      [requestId],
    );
    await getPool().query(
      `UPDATE users SET status = 'inactive' WHERE id = $1`,
      [s.users.memberA],
    );

    const result = await getRequestForCopy(
      getPool(),
      {
        userId: s.users.admin,
        tenantId: s.tenantId,
        isTenantAdmin: true,
        isTenantWideRequester: false,
      },
      requestId,
    );

    // Both targets unresolvable → none carried over, both reported.
    expect(result.targets).toEqual([]);
    expect([...result.droppedTargets].sort()).toEqual(
      ['個人（退会済み）', '組織（削除済み）'],
    );
    expect(result.orgMeta).toEqual({});
    expect(result.userMeta).toEqual({});
  });

  it('rejects copy attempt by an unrelated assignee with permission_denied', async () => {
    const s = await createDomainScenario(getPool());
    const adminCookie = await makeSessionCookie({
      userId: s.users.admin, tenantId: s.tenantId, tenantCode: s.tenantCode,
    });
    const create = await createReq(
      new NextRequest(`http://localhost/t/${s.tenantCode}/api/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: adminCookie },
        body: JSON.stringify({
          title: 'private one',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
          targets: [{ type: 'user', userId: s.users.memberA }],
        }),
      }),
      { params: Promise.resolve({ code: s.tenantCode }) },
    );
    const { id: requestId } = await create.json();

    await expect(
      getRequestForCopy(
        getPool(),
        {
          userId: s.users.memberA,
          tenantId: s.tenantId,
          isTenantAdmin: false,
          isTenantWideRequester: false,
        },
        requestId,
      ),
    ).rejects.toMatchObject({
      name: 'CopySourceError',
      code: 'permission_denied',
    });
  });

  it('returns not_found for an unknown id', async () => {
    const s = await createDomainScenario(getPool());
    await expect(
      getRequestForCopy(
        getPool(),
        {
          userId: s.users.admin,
          tenantId: s.tenantId,
          isTenantAdmin: true,
          isTenantWideRequester: false,
        },
        '00000000-0000-0000-0000-000000000000',
      ),
    ).rejects.toBeInstanceOf(CopySourceError);
  });
});
