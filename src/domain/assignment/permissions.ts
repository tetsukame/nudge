import type pg from 'pg';

/**
 * `actor` is a manager of `subject` iff actor is listed in `org_unit_manager`
 * for an org_unit that is an ancestor (closure) of any org_unit the subject
 * belongs to.
 */
export async function isManagerOf(
  client: pg.PoolClient,
  actorUserId: string,
  subjectUserId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1
         FROM user_org_unit subj
         JOIN org_unit_closure c ON c.descendant_id = subj.org_unit_id
         JOIN org_unit_manager m ON m.org_unit_id = c.ancestor_id
        WHERE subj.user_id = $1
          AND m.user_id = $2
     ) AS ok`,
    [subjectUserId, actorUserId],
  );
  return rows[0].ok;
}

export type SubstituteContext = {
  requesterId: string;
  assigneeId: string;
};

/**
 * Substitution permission:
 *   actor === requester  OR  actor is a manager of the assignee.
 * Spec: "依頼者 or 対象者の上長".
 */
export async function canSubstitute(
  client: pg.PoolClient,
  ctx: SubstituteContext,
  actorUserId: string,
): Promise<boolean> {
  if (actorUserId === ctx.requesterId) return true;
  return isManagerOf(client, actorUserId, ctx.assigneeId);
}
