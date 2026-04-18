import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext } from '../types.js';
import {
  canTargetOutsideScope,
  getVisibleOrgUnitIds,
} from '../request/permissions.js';

export type OrgTreeNode = {
  id: string;
  name: string;
  memberCount: number;
  children: OrgTreeNode[];
};

type OrgUnitRow = {
  id: string;
  name: string;
  parent_id: string | null;
  member_count: string; // bigint comes as string from pg
};

export async function getOrgTree(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<OrgTreeNode[]> {
  return withTenant(pool, actor.tenantId, async (client) => {
    let visibleIds: string[] | null = null;

    if (!canTargetOutsideScope(actor)) {
      visibleIds = await getVisibleOrgUnitIds(client, actor.userId);
      if (visibleIds.length === 0) return [];
    }

    let rows: OrgUnitRow[];

    if (visibleIds === null) {
      // Load all org units
      const { rows: r } = await client.query<OrgUnitRow>(
        `SELECT ou.id, ou.name, ou.parent_id,
                (SELECT COUNT(*) FROM user_org_unit uou
                   JOIN users u ON u.id = uou.user_id
                  WHERE uou.org_unit_id = ou.id AND u.status = 'active') AS member_count
           FROM org_unit ou
          ORDER BY ou.level ASC, ou.name ASC`,
      );
      rows = r;
    } else {
      const { rows: r } = await client.query<OrgUnitRow>(
        `SELECT ou.id, ou.name, ou.parent_id,
                (SELECT COUNT(*) FROM user_org_unit uou
                   JOIN users u ON u.id = uou.user_id
                  WHERE uou.org_unit_id = ou.id AND u.status = 'active') AS member_count
           FROM org_unit ou
          WHERE ou.id = ANY($1)
          ORDER BY ou.level ASC, ou.name ASC`,
        [visibleIds],
      );
      rows = r;
    }

    // Build map
    const visibleSet = new Set(rows.map((r) => r.id));
    const nodeMap = new Map<string, OrgTreeNode>();

    for (const row of rows) {
      nodeMap.set(row.id, {
        id: row.id,
        name: row.name,
        memberCount: parseInt(row.member_count, 10),
        children: [],
      });
    }

    // Build tree: nodes whose parent_id is NULL or whose parent is NOT in visible set
    // become top-level
    const roots: OrgTreeNode[] = [];
    for (const row of rows) {
      const node = nodeMap.get(row.id)!;
      if (row.parent_id === null || !visibleSet.has(row.parent_id)) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(row.parent_id);
        if (parent) {
          parent.children.push(node);
        }
      }
    }

    return roots;
  });
}
