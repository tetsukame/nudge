import pg from 'pg';
import type { OrgSyncSource, OrgSyncResult } from './types';

export async function reconcileOrgs(
  adminPool: pg.Pool,
  tenantId: string,
  source: OrgSyncSource,
): Promise<OrgSyncResult> {
  const result: OrgSyncResult = { created: 0, updated: 0, removed: 0, membershipsUpdated: 0 };

  // Collect all orgs
  const allOrgs: { externalId: string; name: string; parentExternalId: string | null; level: number }[] = [];
  for await (const chunk of source.fetchAllOrgs()) {
    allOrgs.push(...chunk);
  }
  const seenExternalIds = new Set(allOrgs.map((o) => o.externalId));

  // Upsert org_units (parent_id set to NULL initially)
  const extIdToDbId = new Map<string, string>();
  for (const org of allOrgs) {
    const { rows } = await adminPool.query<{ id: string; action: string }>(
      `INSERT INTO org_unit (tenant_id, external_id, name, level, parent_id)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (tenant_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level
       WHERE org_unit.name != EXCLUDED.name OR org_unit.level != EXCLUDED.level
       RETURNING id, CASE WHEN xmax = 0 THEN 'created' ELSE 'updated' END AS action`,
      [tenantId, org.externalId, org.name, org.level],
    );
    if (rows.length > 0) {
      extIdToDbId.set(org.externalId, rows[0].id);
      if (rows[0].action === 'created') result.created++;
      else result.updated++;
    } else {
      const existing = await adminPool.query<{ id: string }>(
        `SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id = $2`, [tenantId, org.externalId],
      );
      if (existing.rows[0]) extIdToDbId.set(org.externalId, existing.rows[0].id);
    }
  }

  // Set parent_id
  for (const org of allOrgs) {
    if (org.parentExternalId) {
      const parentDbId = extIdToDbId.get(org.parentExternalId);
      const childDbId = extIdToDbId.get(org.externalId);
      if (parentDbId && childDbId) {
        await adminPool.query(
          `UPDATE org_unit SET parent_id = $1 WHERE id = $2 AND (parent_id IS NULL OR parent_id != $1)`,
          [parentDbId, childDbId],
        );
      }
    }
  }

  // Remove orgs not in source (only if no members)
  const { rows: existingOrgs } = await adminPool.query<{ id: string; external_id: string }>(
    `SELECT id, external_id FROM org_unit WHERE tenant_id = $1 AND external_id IS NOT NULL`, [tenantId],
  );
  for (const existing of existingOrgs) {
    if (!seenExternalIds.has(existing.external_id)) {
      const { rows: members } = await adminPool.query(
        `SELECT 1 FROM user_org_unit WHERE org_unit_id = $1 LIMIT 1`, [existing.id],
      );
      if (members.length === 0) {
        await adminPool.query(`DELETE FROM org_unit_closure WHERE ancestor_id = $1 OR descendant_id = $1`, [existing.id]);
        await adminPool.query(`DELETE FROM org_unit WHERE id = $1`, [existing.id]);
        result.removed++;
      }
    }
  }

  // Rebuild closure
  await adminPool.query(`DELETE FROM org_unit_closure WHERE tenant_id = $1`, [tenantId]);
  await adminPool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, id AS ancestor, 0 AS depth FROM org_unit WHERE tenant_id = $1
       UNION ALL
       SELECT o.id, t.ancestor, t.depth + 1
       FROM org_unit o JOIN tree t ON o.parent_id = t.id WHERE o.tenant_id = $1
     )
     INSERT INTO org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
     SELECT $1, ancestor, id, depth FROM tree`,
    [tenantId],
  );

  // Sync memberships
  const allMemberships: { orgExternalId: string; userExternalId: string; isPrimary: boolean }[] = [];
  for await (const chunk of source.fetchOrgMemberships()) {
    allMemberships.push(...chunk);
  }
  if (allMemberships.length > 0) {
    await adminPool.query(
      `DELETE FROM user_org_unit WHERE tenant_id = $1
       AND org_unit_id IN (SELECT id FROM org_unit WHERE tenant_id = $1 AND external_id IS NOT NULL)`,
      [tenantId],
    );
    let count = 0;
    for (const m of allMemberships) {
      const orgDbId = extIdToDbId.get(m.orgExternalId);
      if (!orgDbId) continue;
      const { rows: userRows } = await adminPool.query<{ id: string }>(
        `SELECT id FROM users WHERE tenant_id = $1 AND keycloak_sub = $2`, [tenantId, m.userExternalId],
      );
      if (userRows.length === 0) continue;
      await adminPool.query(
        `INSERT INTO user_org_unit (tenant_id, user_id, org_unit_id, is_primary)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, org_unit_id) DO UPDATE SET is_primary = EXCLUDED.is_primary`,
        [tenantId, userRows[0].id, orgDbId, m.isPrimary],
      );
      count++;
    }
    result.membershipsUpdated = count;

    // Ensure each user has at least one primary
    await adminPool.query(
      `UPDATE user_org_unit uou SET is_primary = true
       WHERE uou.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM user_org_unit u2 WHERE u2.user_id = uou.user_id AND u2.is_primary = true)
         AND uou.assigned_at = (SELECT MIN(u3.assigned_at) FROM user_org_unit u3 WHERE u3.user_id = uou.user_id)`,
      [tenantId],
    );
  }

  return result;
}
