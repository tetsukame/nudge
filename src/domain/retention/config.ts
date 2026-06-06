import type pg from 'pg';
import { withTenant } from '../../db/with-tenant';
import type { ActorContext } from '../types';
import { PLATFORM_RETENTION_DEFAULTS } from './defaults';

export class RetentionConfigError extends Error {
  constructor(
    message: string,
    readonly code: 'validation' | 'permission_denied',
  ) {
    super(message);
    this.name = 'RetentionConfigError';
  }
}

/**
 * View 用 (フロント / API レスポンス用)。テナント設定が無い場合は null を
 * 返さず、`isUsingPlatformDefault=true` で platform 既定値を埋めて返す。
 * UI 側で「現在は既定値を使用中」表示ができる。
 */
export type RetentionConfigView = {
  enabled: boolean;
  hardDeleteEnabled: boolean;
  notificationDays: number;
  auditLogDays: number;
  historyDays: number;
  syncLogDays: number;
  softDeleteGraceDays: number;
  isUsingPlatformDefault: boolean;
};

/**
 * Worker 経由で実際の運用判定に使う形。NULL は platform 既定で埋める。
 * `enabled=false` 時は呼び出し側で no-op にする想定。
 */
export type RetentionConfigResolved = {
  tenantId: string;
  enabled: boolean;
  hardDeleteEnabled: boolean;
  notificationDays: number;
  auditLogDays: number;
  historyDays: number;
  syncLogDays: number;
  softDeleteGraceDays: number;
};

export type UpsertRetentionConfigInput = {
  enabled: boolean;
  hardDeleteEnabled?: boolean;
  notificationDays?: number | null;
  auditLogDays?: number | null;
  historyDays?: number | null;
  syncLogDays?: number | null;
  softDeleteGraceDays?: number;
};

function ensureAdmin(actor: ActorContext) {
  if (!actor.isTenantAdmin) {
    throw new RetentionConfigError('tenant_admin only', 'permission_denied');
  }
}

function validateOptionalDays(value: number | null | undefined, name: string): void {
  if (value == null) return;
  if (!Number.isInteger(value) || value <= 0) {
    throw new RetentionConfigError(
      `${name} must be a positive integer (or null to use platform default)`,
      'validation',
    );
  }
}

function validate(input: UpsertRetentionConfigInput) {
  validateOptionalDays(input.notificationDays, 'notificationDays');
  validateOptionalDays(input.auditLogDays, 'auditLogDays');
  validateOptionalDays(input.historyDays, 'historyDays');
  validateOptionalDays(input.syncLogDays, 'syncLogDays');
  if (input.softDeleteGraceDays !== undefined) {
    if (!Number.isInteger(input.softDeleteGraceDays) || input.softDeleteGraceDays <= 0) {
      throw new RetentionConfigError(
        'softDeleteGraceDays must be a positive integer',
        'validation',
      );
    }
  }
}

type RetentionConfigRow = {
  enabled: boolean;
  hard_delete_enabled: boolean;
  notification_days: number | null;
  audit_log_days: number | null;
  history_days: number | null;
  sync_log_days: number | null;
  soft_delete_grace_days: number;
};

export async function getRetentionConfigView(
  pool: pg.Pool,
  actor: ActorContext,
): Promise<RetentionConfigView> {
  ensureAdmin(actor);
  return withTenant(pool, actor.tenantId, async (client) => {
    const { rows } = await client.query<RetentionConfigRow>(
      `SELECT enabled, hard_delete_enabled,
              notification_days, audit_log_days, history_days, sync_log_days,
              soft_delete_grace_days
         FROM retention_config WHERE tenant_id = $1`,
      [actor.tenantId],
    );
    const d = PLATFORM_RETENTION_DEFAULTS;
    if (rows.length === 0) {
      return {
        enabled: false,
        hardDeleteEnabled: false,
        notificationDays: d.notificationDays,
        auditLogDays: d.auditLogDays,
        historyDays: d.historyDays,
        syncLogDays: d.syncLogDays,
        softDeleteGraceDays: d.softDeleteGraceDays,
        isUsingPlatformDefault: true,
      };
    }
    const r = rows[0];
    return {
      enabled: r.enabled,
      hardDeleteEnabled: r.hard_delete_enabled,
      notificationDays: r.notification_days ?? d.notificationDays,
      auditLogDays: r.audit_log_days ?? d.auditLogDays,
      historyDays: r.history_days ?? d.historyDays,
      syncLogDays: r.sync_log_days ?? d.syncLogDays,
      softDeleteGraceDays: r.soft_delete_grace_days,
      isUsingPlatformDefault: false,
    };
  });
}

/**
 * Worker から呼ばれる。RLS 経由ではなく admin pool 直接読み取り想定で
 * pool だけ受ける (テナント単位での呼び出しは呼び出し側ループ)。
 */
export async function getRetentionConfigResolved(
  pool: pg.Pool,
  tenantId: string,
): Promise<RetentionConfigResolved> {
  const { rows } = await pool.query<RetentionConfigRow>(
    `SELECT enabled, hard_delete_enabled,
            notification_days, audit_log_days, history_days, sync_log_days,
            soft_delete_grace_days
       FROM retention_config WHERE tenant_id = $1`,
    [tenantId],
  );
  const d = PLATFORM_RETENTION_DEFAULTS;
  if (rows.length === 0) {
    return {
      tenantId,
      enabled: false,
      hardDeleteEnabled: false,
      notificationDays: d.notificationDays,
      auditLogDays: d.auditLogDays,
      historyDays: d.historyDays,
      syncLogDays: d.syncLogDays,
      softDeleteGraceDays: d.softDeleteGraceDays,
    };
  }
  const r = rows[0];
  return {
    tenantId,
    enabled: r.enabled,
    hardDeleteEnabled: r.hard_delete_enabled,
    notificationDays: r.notification_days ?? d.notificationDays,
    auditLogDays: r.audit_log_days ?? d.auditLogDays,
    historyDays: r.history_days ?? d.historyDays,
    syncLogDays: r.sync_log_days ?? d.syncLogDays,
    softDeleteGraceDays: r.soft_delete_grace_days,
  };
}

export async function upsertRetentionConfig(
  pool: pg.Pool,
  actor: ActorContext,
  input: UpsertRetentionConfigInput,
): Promise<void> {
  ensureAdmin(actor);
  validate(input);
  await withTenant(pool, actor.tenantId, async (client) => {
    await client.query(
      `INSERT INTO retention_config (
         tenant_id, enabled, hard_delete_enabled,
         notification_days, audit_log_days, history_days, sync_log_days,
         soft_delete_grace_days
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 7))
       ON CONFLICT (tenant_id) DO UPDATE SET
         enabled              = EXCLUDED.enabled,
         hard_delete_enabled  = EXCLUDED.hard_delete_enabled,
         notification_days    = EXCLUDED.notification_days,
         audit_log_days       = EXCLUDED.audit_log_days,
         history_days         = EXCLUDED.history_days,
         sync_log_days        = EXCLUDED.sync_log_days,
         soft_delete_grace_days = EXCLUDED.soft_delete_grace_days,
         updated_at           = now()`,
      [
        actor.tenantId,
        input.enabled,
        input.hardDeleteEnabled ?? false,
        input.notificationDays ?? null,
        input.auditLogDays ?? null,
        input.historyDays ?? null,
        input.syncLogDays ?? null,
        input.softDeleteGraceDays ?? null,
      ],
    );

    // NDG-87 安全装置: 設定変更を audit_log に残す
    await client.query(
      `INSERT INTO audit_log
         (tenant_id, actor_user_id, action, target_type, target_id, payload_json)
       VALUES ($1, $2, 'settings.retention.changed', 'tenant', $1, $3::jsonb)`,
      [
        actor.tenantId, actor.userId,
        JSON.stringify({
          enabled: input.enabled,
          hardDeleteEnabled: input.hardDeleteEnabled ?? false,
          notificationDays: input.notificationDays ?? null,
          auditLogDays: input.auditLogDays ?? null,
          historyDays: input.historyDays ?? null,
          syncLogDays: input.syncLogDays ?? null,
          softDeleteGraceDays: input.softDeleteGraceDays ?? null,
        }),
      ],
    );
  });
}
