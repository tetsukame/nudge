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

export async function searchUsers(
  pool: pg.Pool,
  actor: ActorContext,
  query: string,
  limit = 20,
): Promise<UserSearchResult[]> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const pattern = `%${query}%`;

    let rows: UserRow[];

    if (canTargetOutsideScope(actor)) {
      const { rows: r } = await client.query<UserRow>(
        `SELECT u.id, u.display_name, u.email,
                (SELECT ou.name FROM user_org_unit uou
                   JOIN org_unit ou ON ou.id = uou.org_unit_id
                  WHERE uou.user_id = u.id AND uou.is_primary = true
                  LIMIT 1) AS org_unit_name
           FROM users u
          WHERE u.status = 'active'
            AND (u.display_name ILIKE $1 OR u.email ILIKE $1)
          ORDER BY u.display_name ASC
          LIMIT $2`,
        [pattern, limit],
      );
      rows = r;
    } else {
      const visibleIds = await getVisibleOrgUnitIds(client, actor.userId);
      if (visibleIds.length === 0) return [];

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
          ORDER BY u.display_name ASC
          LIMIT $3`,
        [pattern, visibleIds, limit],
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
