import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import {
  canTargetOutsideScope,
  getVisibleOrgUnitIds,
} from '../request/permissions';

export type UserSearchResult = {
  id: string;
  displayName: string;
  email: string;
  orgUnitName: string | null;
};

type UserRow = {
  id: string;
  display_name: string;
  email: string;
  org_unit_name: string | null;
};

export type SearchUsersOptions = {
  /** 限定の所属で絞り込む。指定 org_unit_id 配下のユーザーのみ。 */
  orgUnitId?: string;
};

export async function searchUsers(
  pool: pg.Pool,
  actor: ActorContext,
  query: string,
  limit = 20,
  options: SearchUsersOptions = {},
): Promise<UserSearchResult[]> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const pattern = `%${query}%`;

    let rows: UserRow[];

    // 所属フィルタの WHERE 句 (指定があれば user_org_unit にメンバーシップが必要)
    const orgFilterJoin = options.orgUnitId
      ? `AND EXISTS (SELECT 1 FROM user_org_unit uof
                       WHERE uof.user_id = u.id AND uof.org_unit_id = $`
      : '';

    if (canTargetOutsideScope(actor)) {
      const params: unknown[] = [pattern];
      let orgClause = '';
      if (options.orgUnitId) {
        params.push(options.orgUnitId);
        orgClause = `${orgFilterJoin}${params.length})`;
      }
      params.push(limit);
      const { rows: r } = await client.query<UserRow>(
        `SELECT u.id, u.display_name, u.email,
                (SELECT ou.name FROM user_org_unit uou
                   JOIN org_unit ou ON ou.id = uou.org_unit_id
                  WHERE uou.user_id = u.id AND uou.is_primary = true
                  LIMIT 1) AS org_unit_name
           FROM users u
          WHERE u.status = 'active'
            AND (u.display_name ILIKE $1 OR u.email ILIKE $1)
            ${orgClause}
          ORDER BY u.display_name ASC
          LIMIT $${params.length}`,
        params,
      );
      rows = r;
    } else {
      const visibleIds = await getVisibleOrgUnitIds(client, actor.userId);
      if (visibleIds.length === 0) return [];

      const params: unknown[] = [pattern, visibleIds];
      let orgClause = '';
      if (options.orgUnitId) {
        params.push(options.orgUnitId);
        orgClause = `${orgFilterJoin}${params.length})`;
      }
      params.push(limit);
      const { rows: r } = await client.query<UserRow>(
        `SELECT DISTINCT u.id, u.display_name, u.email,
                (SELECT ou.name FROM user_org_unit uou
                   JOIN org_unit ou ON ou.id = uou.org_unit_id
                  WHERE uou.user_id = u.id AND uou.is_primary = true
                  LIMIT 1) AS org_unit_name
           FROM users u
           JOIN user_org_unit uou2 ON uou2.user_id = u.id
          WHERE u.status = 'active'
            AND uou2.org_unit_id = ANY($2)
            AND (u.display_name ILIKE $1 OR u.email ILIKE $1)
            ${orgClause}
          ORDER BY u.display_name ASC
          LIMIT $${params.length}`,
        params,
      );
      rows = r;
    }

    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      email: r.email,
      orgUnitName: r.org_unit_name,
    }));
  });
}
