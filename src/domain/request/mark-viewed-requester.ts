import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export async function markViewedByRequester(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
): Promise<void> {
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `UPDATE request
          SET last_viewed_by_requester_at = now()
        WHERE id = $1 AND created_by_user_id = $2`,
      [requestId, actor.userId],
    );
  });
}
