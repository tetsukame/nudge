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
   * 'visible': groups the actor can see (member / creator / tenant_admin)
   * 'targetable': groups the actor can address as a target (= visible).
   */
  scope?: 'visible' | 'targetable';
};

export async function listGroups(
  pool: pg.Pool,
  actor: ActorContext,
  input: ListGroupsInput = {},
): Promise<GroupListItem[]> {
  const _ = input.scope; void _; // currently both scopes have identical visibility rules
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
        WHERE
          $2::boolean
          OR g.created_by_user_id = $1
          OR EXISTS(
            SELECT 1 FROM group_member gm
             WHERE gm.group_id = g.id AND gm.user_id = $1
          )
        ORDER BY g.name ASC`,
      [actor.userId, actor.isTenantAdmin],
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
