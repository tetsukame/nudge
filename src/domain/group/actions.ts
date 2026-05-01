import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export class GroupActionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'permission_denied'
      | 'validation'
      | 'conflict'
      | 'kc_readonly',
  ) {
    super(message);
    this.name = 'GroupActionError';
  }
}

export type CreateGroupInput = {
  name: string;
  description?: string;
};

export type UpdateGroupInput = {
  name?: string;
  description?: string | null;
};

function validateName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new GroupActionError('name required', 'validation');
  }
  if (trimmed.length > 100) {
    throw new GroupActionError('name too long (max 100)', 'validation');
  }
  return trimmed;
}

export async function createGroup(
  pool: pg.Pool,
  actor: ActorContext,
  input: CreateGroupInput,
): Promise<{ id: string }> {
  const name = validateName(input.name);
  const description = input.description?.trim() || null;
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "group" (tenant_id, name, description, created_by_user_id, source)
       VALUES ($1, $2, $3, $4, 'nudge')
       RETURNING id`,
      [actor.tenantId, name, description, actor.userId],
    );
    return { id: rows[0].id };
  });
}

async function loadEditable(
  client: pg.PoolClient,
  actor: ActorContext,
  groupId: string,
): Promise<{ id: string; created_by_user_id: string; source: string }> {
  const { rows } = await client.query<{
    id: string;
    created_by_user_id: string;
    source: string;
  }>(
    `SELECT id, created_by_user_id, source FROM "group" WHERE id = $1`,
    [groupId],
  );
  if (rows.length === 0) {
    throw new GroupActionError('group not found', 'not_found');
  }
  const g = rows[0];
  if (g.source === 'keycloak') {
    throw new GroupActionError('keycloak-synced group is read-only in Nudge', 'kc_readonly');
  }
  if (g.created_by_user_id !== actor.userId && !actor.isTenantAdmin) {
    throw new GroupActionError('not creator or tenant_admin', 'permission_denied');
  }
  return g;
}

export async function updateGroup(
  pool: pg.Pool,
  actor: ActorContext,
  groupId: string,
  input: UpdateGroupInput,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await loadEditable(client, actor, groupId);
    const fields: string[] = [];
    const values: unknown[] = [];
    if (input.name !== undefined) {
      values.push(validateName(input.name));
      fields.push(`name = $${values.length}`);
    }
    if (input.description !== undefined) {
      values.push(input.description?.trim() || null);
      fields.push(`description = $${values.length}`);
    }
    if (fields.length === 0) return;
    values.push(groupId);
    await client.query(
      `UPDATE "group" SET ${fields.join(', ')} WHERE id = $${values.length}`,
      values,
    );
  });
}

export async function deleteGroup(
  pool: pg.Pool,
  actor: ActorContext,
  groupId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await loadEditable(client, actor, groupId);
    // group_member は ON DELETE CASCADE 設定済み
    await client.query(`DELETE FROM "group" WHERE id = $1`, [groupId]);
  });
}

export type GroupMemberItem = {
  userId: string;
  displayName: string;
  email: string;
  orgUnitName: string | null;
  addedAt: string;
};

export async function listMembers(
  pool: pg.Pool,
  actor: ActorContext,
  groupId: string,
): Promise<GroupMemberItem[]> {
  return withTenant(pool, actor.tenantId, async (client) => {
    // 閲覧権限: メンバー or 作成者 or tenant_admin
    const { rows: gRows } = await client.query<{ ok: boolean }>(
      `SELECT (g.created_by_user_id = $1
              OR EXISTS(SELECT 1 FROM group_member gm
                         WHERE gm.group_id = g.id AND gm.user_id = $1)
              OR $2::boolean) AS ok
         FROM "group" g
        WHERE g.id = $3`,
      [actor.userId, actor.isTenantAdmin, groupId],
    );
    if (gRows.length === 0) {
      throw new GroupActionError('group not found', 'not_found');
    }
    if (!gRows[0].ok) {
      throw new GroupActionError('not visible', 'permission_denied');
    }
    const { rows } = await client.query<{
      user_id: string;
      display_name: string;
      email: string;
      org_unit_name: string | null;
      added_at: Date;
    }>(
      `SELECT gm.user_id, u.display_name, u.email,
              (
                SELECT ou.name FROM user_org_unit uou
                  JOIN org_unit ou ON ou.id = uou.org_unit_id
                 WHERE uou.user_id = u.id
                 ORDER BY uou.is_primary DESC, ou.name ASC
                 LIMIT 1
              ) AS org_unit_name,
              gm.added_at
         FROM group_member gm
         JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1
        ORDER BY u.display_name ASC`,
      [groupId],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      email: r.email,
      orgUnitName: r.org_unit_name,
      addedAt: new Date(r.added_at).toISOString(),
    }));
  });
}

export async function addMembers(
  pool: pg.Pool,
  actor: ActorContext,
  groupId: string,
  userIds: string[],
): Promise<{ added: number }> {
  if (userIds.length === 0) return { added: 0 };
  return withTenant(pool, actor.tenantId, async (client) => {
    await loadEditable(client, actor, groupId);
    // 同じテナント内のアクティブユーザーであることを確認 (RLS が tenant 範囲を保証)
    const { rows: validRows } = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND status = 'active'`,
      [userIds],
    );
    const validIds = validRows.map((r) => r.id);
    if (validIds.length === 0) return { added: 0 };
    // 競合 (既存メンバー) は ON CONFLICT で無視
    const result = await client.query(
      `INSERT INTO group_member (tenant_id, group_id, user_id, added_by_user_id)
       SELECT $1, $2, u, $3 FROM unnest($4::uuid[]) AS u
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [actor.tenantId, groupId, actor.userId, validIds],
    );
    return { added: result.rowCount ?? 0 };
  });
}

export async function removeMember(
  pool: pg.Pool,
  actor: ActorContext,
  groupId: string,
  userId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await loadEditable(client, actor, groupId);
    await client.query(
      `DELETE FROM group_member WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
  });
}
