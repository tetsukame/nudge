import type pg from 'pg';

/**
 * NDG-90: /root/retention 監視ダッシュボード用の集計クエリ。
 * tenant × table ごとの最新削除実績 / 累計件数を返す。
 *
 * adminPool 直接利用 (platform_admin 専用ページから呼ばれる、cross-tenant)。
 */

export type RetentionSummaryRow = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tableName: string;
  /** retention_config.enabled の現状 (false なら設定されてない / 無効化) */
  enabled: boolean;
  hardDeleteEnabled: boolean;
  totalSoftRows: number;
  totalHardRows: number;
  lastSoftAt: string | null;
  lastHardAt: string | null;
  lastErrorMessage: string | null;
};

const TABLES = ['notification', 'audit_log', 'assignment_status_history', 'sync_log'] as const;

export async function listRetentionSummary(
  pool: pg.Pool,
  limit = 200,
): Promise<RetentionSummaryRow[]> {
  // tenant ごとの retention_config と retention_log を joined で集計
  const { rows } = await pool.query<{
    tenant_id: string;
    tenant_code: string;
    tenant_name: string;
    table_name: string;
    enabled: boolean;
    hard_delete_enabled: boolean;
    total_soft: string;
    total_hard: string;
    last_soft_at: Date | null;
    last_hard_at: Date | null;
    last_error: string | null;
  }>(
    `WITH tt AS (
       SELECT t.id, t.code, t.name, x.table_name
         FROM tenant t
         CROSS JOIN unnest($1::text[]) AS x(table_name)
     )
     SELECT
       tt.id AS tenant_id, tt.code AS tenant_code, tt.name AS tenant_name,
       tt.table_name,
       COALESCE(rc.enabled, false)             AS enabled,
       COALESCE(rc.hard_delete_enabled, false) AS hard_delete_enabled,
       COALESCE(SUM(rl.rows_affected) FILTER (WHERE rl.action='soft'), 0)::text AS total_soft,
       COALESCE(SUM(rl.rows_affected) FILTER (WHERE rl.action='hard'), 0)::text AS total_hard,
       MAX(rl.started_at) FILTER (WHERE rl.action='soft' AND rl.error_message IS NULL) AS last_soft_at,
       MAX(rl.started_at) FILTER (WHERE rl.action='hard' AND rl.error_message IS NULL) AS last_hard_at,
       MAX(rl.error_message) FILTER (WHERE rl.error_message IS NOT NULL)                AS last_error
     FROM tt
     LEFT JOIN retention_config rc ON rc.tenant_id = tt.id
     LEFT JOIN retention_log    rl ON rl.tenant_id = tt.id AND rl.table_name = tt.table_name
     GROUP BY tt.id, tt.code, tt.name, tt.table_name, rc.enabled, rc.hard_delete_enabled
     ORDER BY tt.code, tt.table_name
     LIMIT $2`,
    [Array.from(TABLES), limit],
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    tenantCode: r.tenant_code,
    tenantName: r.tenant_name,
    tableName: r.table_name,
    enabled: r.enabled,
    hardDeleteEnabled: r.hard_delete_enabled,
    totalSoftRows: Number(r.total_soft),
    totalHardRows: Number(r.total_hard),
    lastSoftAt: r.last_soft_at ? new Date(r.last_soft_at).toISOString() : null,
    lastHardAt: r.last_hard_at ? new Date(r.last_hard_at).toISOString() : null,
    lastErrorMessage: r.last_error,
  }));
}
