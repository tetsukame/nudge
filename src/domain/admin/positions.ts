import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { AUDIT_ACTION } from '../_constants';

export class PositionConfigError extends Error {
  constructor(
    message: string,
    readonly code: 'permission_denied' | 'validation',
  ) {
    super(message);
    this.name = 'PositionConfigError';
  }
}

export const DEFAULT_MANAGER_POSITIONS = ['課長', '部長', '室長', '本部長'];

export async function getTenantPositionConfig(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<{ managerPositions: string[] }> {
  if (!actor.isTenantAdmin) {
    throw new PositionConfigError('tenant_admin required', 'permission_denied');
  }
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<{ manager_positions: string[] }>(
      `SELECT manager_positions FROM tenant_position_config WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    return {
      managerPositions:
        rows.length > 0 ? rows[0].manager_positions : DEFAULT_MANAGER_POSITIONS,
    };
  });
}

export async function setTenantPositionConfig(
  pool: pg.Pool,
  actor: ActorContext,
  managerPositions: string[],
): Promise<void> {
  if (!actor.isTenantAdmin) {
    throw new PositionConfigError('tenant_admin required', 'permission_denied');
  }
  const cleaned = Array.from(
    new Set(
      managerPositions
        .map((p) => (typeof p === 'string' ? p.trim() : ''))
        .filter((p) => p.length > 0),
    ),
  );
  if (cleaned.length === 0) {
    throw new PositionConfigError(
      '少なくとも 1 つの職位を指定してください',
      'validation',
    );
  }
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenant_position_config (tenant_id, manager_positions, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET manager_positions = EXCLUDED.manager_positions,
                     updated_at = now()`,
      [actor.tenantId, cleaned],
    );
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, $3, 'tenant', $1, $4::jsonb)`,
      [actor.tenantId, actor.userId, AUDIT_ACTION.TENANT_POSITION_CONFIG_CHANGED, JSON.stringify({ managerPositions: cleaned })],
    );
  });
}
