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
