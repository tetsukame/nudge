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
           SELECT DISTINCT $1::uuid, $2::uuid, uou.user_id
             FROM org_unit_closure c
             JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
             JOIN users u ON u.id = uou.user_id AND u.status = 'active'
            WHERE c.ancestor_id = $3
              AND c.tenant_id = $1::uuid
           ON CONFLICT (request_id, user_id) DO NOTHING`,
          [tenantId, requestId, t.orgUnitId],
        );
        out.org_unit += rowCount ?? 0;
      } else {
        const { rowCount } = await client.query(
          `INSERT INTO assignment(tenant_id, request_id, user_id)
           SELECT DISTINCT $1::uuid, $2::uuid, uou.user_id
             FROM user_org_unit uou
             JOIN users u ON u.id = uou.user_id AND u.status = 'active'
            WHERE uou.org_unit_id = $3
              AND uou.tenant_id = $1::uuid
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
