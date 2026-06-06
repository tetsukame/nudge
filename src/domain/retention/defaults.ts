/**
 * NDG-87/88: retention のプラットフォーム既定値。
 *
 * テナント未設定時 (= retention_config に行がない / 該当列が NULL) は
 * これらを使う。NDG-87 設計レビューで確定:
 *
 * - notification:               90 日 (sent/failed の通知は再送候補にならない)
 * - audit_log:                 730 日 (2 年。一般的なコンプライアンス目線)
 * - assignment_status_history: 365 日 (closed/cancelled の依頼のみ削除対象)
 * - sync_log:                   90 日 (エラー履歴は短期で十分)
 * - soft → hard grace:           7 日 (誤設定リカバリ猶予)
 *
 * env 経由の上書き機構は未実装。OSS 利用者が変更したい場合はとりあえず
 * このファイルを直接編集。需要があれば env 化する。
 */
export const PLATFORM_RETENTION_DEFAULTS = {
  notificationDays: 90,
  auditLogDays: 730,
  historyDays: 365,
  syncLogDays: 90,
  softDeleteGraceDays: 7,
} as const;

export type RetentionDefaults = typeof PLATFORM_RETENTION_DEFAULTS;
