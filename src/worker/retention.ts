import type pg from 'pg';
import { getRetentionConfigResolved } from '../domain/retention/config';
import { logger } from '@/lib/logger';
import { recordRetentionDeleted } from '@/lib/otel';

/**
 * NDG-87/89: retention worker。
 *
 * 1h ごとに動かす。main.ts の tick (60s) に乗っているので、最後の実行から
 * 1h 経っていなければ no-op で抜ける。worker 再起動でカウンタはリセット
 * されるが、起動直後の 1 回は実行されるだけで実害なし。
 *
 * 各 tenant の retention_config を読み、enabled=true の tenant に対し
 * テーブルごとに soft (archived_at セット) → hard (DELETE、hard_delete_enabled
 * のみ) を実行。各テーブル 1 tick 最大 5000 行に制限。
 */

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const BATCH_LIMIT = 5000;

let lastRetentionRunAt = 0;

type RetentionTarget = {
  table: 'notification' | 'audit_log' | 'assignment_status_history' | 'sync_log';
  /** 保持期間日数を返す。tenant resolved config から取得 */
  daysOf: (cfg: {
    notificationDays: number; auditLogDays: number;
    historyDays: number; syncLogDays: number;
  }) => number;
  /** 期限超過の判定で使う timestamp 列 */
  timestampColumn: 'created_at' | 'started_at';
  /** 期限超過に加えて適用する追加 WHERE (e.g. history は closed/cancelled 限定) */
  extraSoftWhere?: string;
};

const TARGETS: RetentionTarget[] = [
  {
    table: 'notification',
    daysOf: (c) => c.notificationDays,
    timestampColumn: 'created_at',
    // sent/failed/skipped のみが retention 対象。pending/sending はまだ処理中
    extraSoftWhere: `status IN ('sent','failed','skipped')`,
  },
  {
    table: 'audit_log',
    daysOf: (c) => c.auditLogDays,
    timestampColumn: 'created_at',
  },
  {
    table: 'assignment_status_history',
    daysOf: (c) => c.historyDays,
    timestampColumn: 'created_at',
    // NDG-87 設計確定: active 中の依頼の遷移履歴は差し戻し根拠として保持
    extraSoftWhere: `assignment_id IN (
      SELECT a.id FROM assignment a
      JOIN request r ON r.id = a.request_id
      WHERE r.status IN ('closed','cancelled')
    )`,
  },
  {
    table: 'sync_log',
    daysOf: (c) => c.syncLogDays,
    timestampColumn: 'started_at',
  },
];

async function logRun(
  pool: pg.Pool,
  tenantId: string,
  tableName: string,
  action: 'soft' | 'hard',
  rowsAffected: number,
  errorMessage: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO retention_log
       (tenant_id, table_name, action, rows_affected, finished_at, error_message)
     VALUES ($1, $2, $3, $4, now(), $5)`,
    [tenantId, tableName, action, rowsAffected, errorMessage],
  );
}

async function runSoftForTable(
  pool: pg.Pool,
  tenantId: string,
  target: RetentionTarget,
  days: number,
): Promise<number> {
  // 期限超過 (timestamp_column < now() - X days) かつ archived_at がまだ NULL
  // かつ tenant 一致。LIMIT 5000 内を 1 トランザクション。
  const where = [
    `tenant_id = $1`,
    `archived_at IS NULL`,
    `${target.timestampColumn} < now() - make_interval(days => $2)`,
  ];
  if (target.extraSoftWhere) where.push(target.extraSoftWhere);

  const sql = `
    UPDATE ${target.table} SET archived_at = now()
     WHERE id IN (
       SELECT id FROM ${target.table}
        WHERE ${where.join(' AND ')}
        LIMIT $3
     )
  `;
  const res = await pool.query(sql, [tenantId, days, BATCH_LIMIT]);
  return res.rowCount ?? 0;
}

async function runHardForTable(
  pool: pg.Pool,
  tenantId: string,
  table: string,
  graceDays: number,
): Promise<number> {
  const sql = `
    DELETE FROM ${table}
     WHERE id IN (
       SELECT id FROM ${table}
        WHERE tenant_id = $1
          AND archived_at IS NOT NULL
          AND archived_at < now() - make_interval(days => $2)
        LIMIT $3
     )
  `;
  const res = await pool.query(sql, [tenantId, graceDays, BATCH_LIMIT]);
  return res.rowCount ?? 0;
}

async function processTenant(
  pool: pg.Pool,
  tenantId: string,
): Promise<void> {
  const cfg = await getRetentionConfigResolved(pool, tenantId);
  if (!cfg.enabled) return;

  for (const target of TARGETS) {
    const days = target.daysOf(cfg);
    // soft step
    try {
      const n = await runSoftForTable(pool, tenantId, target, days);
      if (n > 0) {
        await logRun(pool, tenantId, target.table, 'soft', n);
        // NDG-101
        recordRetentionDeleted({ kind: 'soft', entity: target.table, tenantId, count: n });
      }
    } catch (err) {
      await logRun(pool, tenantId, target.table, 'soft', 0, (err as Error).message)
        .catch(() => {});
    }

    // hard step (opt-in)
    if (cfg.hardDeleteEnabled) {
      try {
        const n = await runHardForTable(pool, tenantId, target.table, cfg.softDeleteGraceDays);
        if (n > 0) {
          await logRun(pool, tenantId, target.table, 'hard', n);
          // NDG-101
          recordRetentionDeleted({ kind: 'hard', entity: target.table, tenantId, count: n });
        }
      } catch (err) {
        await logRun(pool, tenantId, target.table, 'hard', 0, (err as Error).message)
          .catch(() => {});
      }
    }
  }
}

/**
 * 1h 間隔で全 enabled tenant に対し retention を回す。main.ts の 60s tick
 * から毎回呼ばれるが、内部で 1h 間隔を判定し no-op で抜けるので軽量。
 *
 * `force=true` でテスト / 手動実行から間隔を無視できる。
 */
export async function runRetention(pool: pg.Pool, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastRetentionRunAt < RETENTION_INTERVAL_MS) return;
  lastRetentionRunAt = now;

  const { rows } = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM retention_config WHERE enabled = true`,
  );
  for (const r of rows) {
    try {
      await processTenant(pool, r.tenant_id);
    } catch (err) {
      // tenant 単位で握りつぶす。残りの tenant の処理は続行
      logger.error({ err, tenantId: r.tenant_id }, 'retention tenant error');
    }
  }
}

/**
 * テスト用: 1h 間隔の判定をリセット。
 */
export function _resetRetentionScheduler(): void {
  lastRetentionRunAt = 0;
}
