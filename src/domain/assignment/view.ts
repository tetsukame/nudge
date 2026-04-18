import type pg from 'pg';
import { withTenant } from '../../db/with-tenant.js';
import type { ActorContext } from '../types.js';

/**
 * Update last_viewed_at to now() for the given assignment, only if the actor
 * is the assignee.
 */
export async function markViewed(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `UPDATE assignment
          SET last_viewed_at = now()
        WHERE id = $1 AND user_id = $2`,
      [assignmentId, actor.userId],
    );
  });
}

/**
 * Returns true if there are comments (broadcast or assignment-specific) that
 * were created after the assignment's last_viewed_at (or if last_viewed_at is NULL).
 */
export async function hasUnreadComments(
  pool: pg.Pool,
  actor: ActorContext,
  assignmentId: string,
): Promise<boolean> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM request_comment rc
           JOIN assignment a ON a.id = $1
          WHERE rc.request_id = a.request_id
            AND (rc.assignment_id IS NULL OR rc.assignment_id = $1)
            AND (
              a.last_viewed_at IS NULL
              OR rc.created_at > a.last_viewed_at
            )
       ) AS exists`,
      [assignmentId],
    );
    return rows[0].exists;
  });
}
