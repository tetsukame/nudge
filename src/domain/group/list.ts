import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type GroupSource = 'nudge' | 'keycloak';

export type GroupListItem = {
  id: string;
  name: string;
  description: string | null;
  source: GroupSource;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: string;
  memberCount: number;
  isMember: boolean;
  isCreator: boolean;
};

export type ListGroupsInput = {
  /**
   * 'visible': groups the actor can see as member / creator (personal scope).
   *            tenant_admin auto-bypass は適用しない。`/groups` (個人ページ) で使う。
   * 'all_tenant': テナント内の全グループ。tenant_admin 必須。`/admin/groups` で使う。
   */
  scope?: 'visible' | 'all_tenant';
};

export async function listGroups(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListGroupsInput = {},
): Promise<GroupListItem[]> {
  const scope = input.scope ?? 'visible';
  if (scope === 'all_tenant' && !actor.isTenantAdmin) {
    throw new Error('all_tenant scope requires tenant_admin');
  }
  return withTenant(pool, actor.tenantId, async (client) => {
    const whereClause = scope === 'all_tenant'
      ? `WHERE TRUE`
      : `WHERE g.created_by_user_id = $1
             OR EXISTS(
               SELECT 1 FROM group_member gm
                WHERE gm.group_id = g.id AND gm.user_id = $1
             )`;
    const { rows } = await client.query<{
      id: string;
      name: string;
      description: string | null;
      source: GroupSource;
      created_by_user_id: string;
      created_by_name: string | null;
      created_at: Date;
      member_count: number;
      is_member: boolean;
      is_creator: boolean;
    }>(
      `SELECT g.id, g.name, g.description, g.source, g.created_by_user_id,
              cu.display_name AS created_by_name,
              g.created_at,
              (SELECT COUNT(*)::int FROM group_member gm WHERE gm.group_id = g.id) AS member_count,
              EXISTS(
                SELECT 1 FROM group_member gm
                 WHERE gm.group_id = g.id AND gm.user_id = $1
              ) AS is_member,
              (g.created_by_user_id = $1) AS is_creator
         FROM "group" g
         LEFT JOIN users cu ON cu.id = g.created_by_user_id
        ${whereClause}
        ORDER BY g.name ASC`,
      [actor.userId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      createdByUserId: r.created_by_user_id,
      createdByName: r.created_by_name,
      createdAt: new Date(r.created_at).toISOString(),
      memberCount: r.member_count,
      isMember: r.is_member,
      isCreator: r.is_creator,
    }));
  });
}

export async function getGroup(
  pool: pg.Pool,
  actor: ActorContext,
  groupId: string,
): Promise<GroupListItem | null> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      id: string;
      name: string;
      description: string | null;
      source: GroupSource;
      created_by_user_id: string;
      created_by_name: string | null;
      created_at: Date;
      member_count: number;
      is_member: boolean;
      is_creator: boolean;
    }>(
      `SELECT g.id, g.name, g.description, g.source, g.created_by_user_id,
              cu.display_name AS created_by_name,
              g.created_at,
              (SELECT COUNT(*)::int FROM group_member gm WHERE gm.group_id = g.id) AS member_count,
              EXISTS(
                SELECT 1 FROM group_member gm
                 WHERE gm.group_id = g.id AND gm.user_id = $1
              ) AS is_member,
              (g.created_by_user_id = $1) AS is_creator
         FROM "group" g
         LEFT JOIN users cu ON cu.id = g.created_by_user_id
        WHERE g.id = $2
          AND ($3::boolean
               OR g.created_by_user_id = $1
               OR EXISTS(
                 SELECT 1 FROM group_member gm
                  WHERE gm.group_id = g.id AND gm.user_id = $1
               ))`,
      [actor.userId, groupId, actor.isTenantAdmin],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      source: r.source,
      createdByUserId: r.created_by_user_id,
      createdByName: r.created_by_name,
      createdAt: new Date(r.created_at).toISOString(),
      memberCount: r.member_count,
      isMember: r.is_member,
      isCreator: r.is_creator,
    };
  });
}
