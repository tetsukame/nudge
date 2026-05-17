import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type MyDashboard = {
  inbox: {
    unopened: number;
    opened: number;
    overdue: number;
    dueSoon: number; // pending & due within 7 days (not yet overdue)
  };
  sent: {
    inProgress: number; // requests I created with >=1 pending assignment
    overdueRequests: number; // of those, with >=1 overdue pending assignment
  };
  subordinate: {
    isManager: boolean;
    pending: number; // pending assignments across my subtree
    overdue: number;
  };
};

/**
 * 「自分の状況」ダッシュボード用の集計。inbox（自分宛）/ sent（送信した依頼）/
 * subordinate（マネージャのみ）を 1 リクエストでまとめて返す。
 */
export async function getMyDashboard(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<MyDashboard> {
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows: inboxRows } = await client.query<{
      unopened: number;
      opened: number;
      overdue: number;
      due_soon: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE a.status = 'unopened')::int AS unopened,
         COUNT(*) FILTER (WHERE a.status = 'opened')::int AS opened,
         COUNT(*) FILTER (
           WHERE a.status IN ('unopened','opened')
             AND r.due_at IS NOT NULL AND r.due_at < now()
         )::int AS overdue,
         COUNT(*) FILTER (
           WHERE a.status IN ('unopened','opened')
             AND r.due_at IS NOT NULL
             AND r.due_at >= now()
             AND r.due_at <= now() + interval '7 days'
         )::int AS due_soon
       FROM assignment a
       JOIN request r ON r.id = a.request_id
      WHERE a.user_id = $1`,
      [actor.userId],
    );

    const { rows: sentRows } = await client.query<{
      in_progress: number;
      overdue_requests: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE pending > 0)::int AS in_progress,
         COUNT(*) FILTER (WHERE overdue_pending > 0)::int AS overdue_requests
       FROM (
         SELECT r.id,
           COUNT(a.*) FILTER (WHERE a.status IN ('unopened','opened')) AS pending,
           COUNT(a.*) FILTER (
             WHERE a.status IN ('unopened','opened')
               AND r.due_at IS NOT NULL AND r.due_at < now()
           ) AS overdue_pending
         FROM request r
         LEFT JOIN assignment a ON a.request_id = r.id
        WHERE r.created_by_user_id = $1
        GROUP BY r.id
       ) s`,
      [actor.userId],
    );

    const { rows: mgrRows } = await client.query<{ is_manager: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM org_unit_manager WHERE user_id = $1
       ) AS is_manager`,
      [actor.userId],
    );
    const isManager = mgrRows[0]?.is_manager ?? false;

    let subPending = 0;
    let subOverdue = 0;
    if (isManager) {
      const { rows: subRows } = await client.query<{
        pending: number;
        overdue: number;
      }>(
        `WITH my_subtree_users AS (
           SELECT DISTINCT uou.user_id
             FROM org_unit_manager m
             JOIN org_unit_closure c ON c.ancestor_id = m.org_unit_id
             JOIN user_org_unit uou ON uou.org_unit_id = c.descendant_id
                                   AND uou.user_id != $1
            WHERE m.user_id = $1
         )
         SELECT
           COUNT(*) FILTER (WHERE a.status IN ('unopened','opened'))::int AS pending,
           COUNT(*) FILTER (
             WHERE a.status IN ('unopened','opened')
               AND r.due_at IS NOT NULL AND r.due_at < now()
           )::int AS overdue
         FROM assignment a
         JOIN request r ON r.id = a.request_id
         JOIN my_subtree_users mu ON mu.user_id = a.user_id`,
        [actor.userId],
      );
      subPending = subRows[0]?.pending ?? 0;
      subOverdue = subRows[0]?.overdue ?? 0;
    }

    return {
      inbox: {
        unopened: inboxRows[0]?.unopened ?? 0,
        opened: inboxRows[0]?.opened ?? 0,
        overdue: inboxRows[0]?.overdue ?? 0,
        dueSoon: inboxRows[0]?.due_soon ?? 0,
      },
      sent: {
        inProgress: sentRows[0]?.in_progress ?? 0,
        overdueRequests: sentRows[0]?.overdue_requests ?? 0,
      },
      subordinate: {
        isManager,
        pending: subPending,
        overdue: subOverdue,
      },
    };
  });
}
