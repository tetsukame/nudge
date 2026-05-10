import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import type { TargetSpec } from './expand-targets';

export class CopySourceError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'not_found',
  ) {
    super(message);
    this.name = 'CopySourceError';
  }
}

export type CopySource = {
  title: string;
  body: string;
  estimatedMinutes: number;
  senderOrgUnitId: string | null;
  targets: TargetSpec[];
};

/**
 * 既存の request を「コピーして新規作成」フォームの初期値に変換する。
 * 認可: 当該 request の作成者、tenant_admin、または tenant_wide_requester に許可する。
 * 期限 (due_at) は意図的に含めない（コピー利用ケースは新しい期限を毎回指定する想定）。
 */
export async function getRequestForCopy(
  pool: pg.Pool,
  actor: ActorContext,
  requestId: string,
): Promise<CopySource> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: reqRows } = await client.query<{
      id: string;
      title: string;
      body: string;
      estimated_minutes: number | null;
      sender_org_unit_id: string | null;
      created_by_user_id: string;
    }>(
      `SELECT id, title, body, estimated_minutes,
              sender_org_unit_id, created_by_user_id
         FROM request WHERE id = $1`,
      [requestId],
    );
    if (reqRows.length === 0) {
      throw new CopySourceError('request not found', 'not_found');
    }
    const r = reqRows[0];

    const isCreator = actor.userId === r.created_by_user_id;
    if (!isCreator && !actor.isTenantAdmin && !actor.isTenantWideRequester) {
      throw new CopySourceError(
        'only the creator, tenant_admin, or tenant_wide_requester can copy this request',
        'permission_denied',
      );
    }

    const { rows: tgtRows } = await client.query<{
      target_type: 'user' | 'org_unit' | 'group' | 'all';
      target_id: string | null;
      include_descendants: boolean | null;
    }>(
      `SELECT target_type, target_id, include_descendants
         FROM request_target WHERE request_id = $1`,
      [requestId],
    );
    const targets: TargetSpec[] = [];
    for (const t of tgtRows) {
      if (t.target_type === 'user' && t.target_id) {
        targets.push({ type: 'user', userId: t.target_id });
      } else if (t.target_type === 'org_unit' && t.target_id) {
        targets.push({
          type: 'org_unit',
          orgUnitId: t.target_id,
          includeDescendants: t.include_descendants ?? false,
        });
      } else if (t.target_type === 'group' && t.target_id) {
        targets.push({ type: 'group', groupId: t.target_id });
      } else if (t.target_type === 'all') {
        targets.push({ type: 'all' });
      }
    }

    return {
      title: r.title,
      body: r.body,
      estimatedMinutes: r.estimated_minutes ?? 5,
      senderOrgUnitId: r.sender_org_unit_id,
      targets,
    };
  });
}
