import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { AUDIT_ACTION } from '../_constants';

export class ReassignRequesterError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'permission_denied'
      | 'not_found'
      | 'invalid_target'
      | 'validation',
  ) {
    super(message);
    this.name = 'ReassignRequesterError';
  }
}

export type ReassignRequesterResult = {
  requestId: string;
  previousUserId: string;
  newUserId: string;
};

/**
 * 依頼の作成者 (created_by_user_id) を別のアクティブユーザーに差し替える。
 * 退職者が作成した依頼を引き継がせるための tenant_admin 専用操作。
 */
export async function reassignRequester(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
  newUserId: string,
): Promise<ReassignRequesterResult> {
  if (!actor.isTenantAdmin) {
    throw new ReassignRequesterError(
      'tenant_admin required',
      'permission_denied',
    );
  }

  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: reqRows } = await client.query<{
      id: string;
      created_by_user_id: string;
    }>(
      `SELECT id, created_by_user_id FROM request WHERE id = $1`,
      [requestId],
    );
    if (reqRows.length === 0) {
      throw new ReassignRequesterError('request not found', 'not_found');
    }
    const previousUserId = reqRows[0].created_by_user_id;

    if (previousUserId === newUserId) {
      throw new ReassignRequesterError(
        'new requester is the same as the current one',
        'validation',
      );
    }

    const { rows: userRows } = await client.query<{ status: string }>(
      `SELECT status FROM users WHERE id = $1`,
      [newUserId],
    );
    if (userRows.length === 0) {
      throw new ReassignRequesterError(
        'target user not found in this tenant',
        'invalid_target',
      );
    }
    if (userRows[0].status !== 'active') {
      throw new ReassignRequesterError(
        'cannot reassign to an inactive user',
        'invalid_target',
      );
    }

    await client.query(
      `UPDATE request SET created_by_user_id = $1 WHERE id = $2`,
      [newUserId, requestId],
    );

    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'request', $4, $5::jsonb)`,
      [
        actor.tenantId,
        actor.userId,
        AUDIT_ACTION.REQUEST_REQUESTER_REASSIGNED,
        requestId,
        JSON.stringify({ previousUserId, newUserId }),
      ],
    );

    return { requestId, previousUserId, newUserId };
  });
}
