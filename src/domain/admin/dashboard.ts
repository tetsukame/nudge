import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';

export type DashboardStats = {
  users: { active: number; inactive: number; total: number };
  orgUnits: number;
  groups: { nudge: number; keycloak: number; total: number };
  requests: { active: number };
  assignments: {
    pending: number; // unopened + opened
    overdue: number;
  };
  notifications: {
    failed: number; // permanent failures (next_attempt_at IS NULL)
  };
};

export class AdminDashboardError extends Error {
  constructor(message: string, readonly code: 'permission_denied') {
    super(message);
    this.name = 'AdminDashboardError';
  }
}

export async function getDashboardStats(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<DashboardStats> {
  if (!actor.isTenantAdmin) {
    throw new AdminDashboardError('tenant_admin required', 'permission_denied');
  }
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{
      users_active: string;
      users_inactive: string;
      org_units: string;
      groups_nudge: string;
      groups_keycloak: string;
      requests_active: string;
      assignments_pending: string;
      assignments_overdue: string;
      notifications_failed: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM users WHERE status = 'active') AS users_active,
         (SELECT COUNT(*)::text FROM users WHERE status = 'inactive') AS users_inactive,
         (SELECT COUNT(*)::text FROM org_unit WHERE status = 'active') AS org_units,
         (SELECT COUNT(*)::text FROM "group" WHERE source = 'nudge') AS groups_nudge,
         (SELECT COUNT(*)::text FROM "group" WHERE source = 'keycloak') AS groups_keycloak,
         (SELECT COUNT(*)::text FROM request WHERE status = 'active') AS requests_active,
         (SELECT COUNT(*)::text FROM assignment WHERE status IN ('unopened','opened')) AS assignments_pending,
         (SELECT COUNT(*)::text FROM assignment a
            JOIN request r ON r.id = a.request_id
           WHERE a.status IN ('unopened','opened')
             AND r.due_at IS NOT NULL AND r.due_at < now()) AS assignments_overdue,
         (SELECT COUNT(*)::text FROM notification
           WHERE status = 'failed' AND next_attempt_at IS NULL) AS notifications_failed`,
    );
    const r = rows[0];
    const usersActive = parseInt(r.users_active, 10);
    const usersInactive = parseInt(r.users_inactive, 10);
    const groupsNudge = parseInt(r.groups_nudge, 10);
    const groupsKeycloak = parseInt(r.groups_keycloak, 10);
    return {
      users: {
        active: usersActive,
        inactive: usersInactive,
        total: usersActive + usersInactive,
      },
      orgUnits: parseInt(r.org_units, 10),
      groups: {
        nudge: groupsNudge,
        keycloak: groupsKeycloak,
        total: groupsNudge + groupsKeycloak,
      },
      requests: { active: parseInt(r.requests_active, 10) },
      assignments: {
        pending: parseInt(r.assignments_pending, 10),
        overdue: parseInt(r.assignments_overdue, 10),
      },
      notifications: { failed: parseInt(r.notifications_failed, 10) },
    };
  });
}

/**
 * Lightweight count of permanently-failed notifications.
 * Used by the sidebar to show a badge without fetching the full dashboard.
 */
export async function countFailedNotifications(
  pool: pg.Pool,
  tenantId: string,
): Promise<number> {
  return withTenant(pool, tenantId, async (client) => {
    const { rows } = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM notification
        WHERE status = 'failed' AND next_attempt_at IS NULL`,
    );
    return parseInt(rows[0].n, 10);
  });
}
