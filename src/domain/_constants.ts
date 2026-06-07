/**
 * NDG-91 (A2 E1): マジック文字列をリテラル型ユニオン + const で集約する。
 *
 * 目的:
 *   - 値の追加 / リネーム時に 1 ファイル変更で TypeScript が全参照を検出
 *   - 「`'tenant_admin'` という文字列が他にどこで使われているか」が grep
 *     ではなく型システムで分かる
 *   - `kind: 'created' | 'reminder_before' | ...` のような型宣言が複数
 *     ファイルで重複している現状を解消
 *
 * 本 PR で集約するのは roles / audit actions / notification kinds の 3 種。
 * request status / assignment status 等は SQL 文字列内利用が多いため、
 * リスクを切り分けて別 PR で扱う。
 */

// ─────────────────────────────────────────────────────────
// Role
// ─────────────────────────────────────────────────────────

export const ROLE = {
  TENANT_ADMIN: 'tenant_admin',
  TENANT_WIDE_REQUESTER: 'tenant_wide_requester',
  MANAGER: 'manager',
  AUDITOR: 'auditor',
  PLATFORM_ADMIN: 'platform_admin',
} as const;

export type Role = (typeof ROLE)[keyof typeof ROLE];

/** tenant_admin が任意に付与 / 剥奪できるロール。platform_admin は含まない。 */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  ROLE.TENANT_ADMIN,
  ROLE.TENANT_WIDE_REQUESTER,
  ROLE.MANAGER,
  ROLE.AUDITOR,
] as const;

// ─────────────────────────────────────────────────────────
// Audit log action
// ─────────────────────────────────────────────────────────

export const AUDIT_ACTION = {
  // request 関連
  REQUEST_CREATED: 'request.created',
  REQUEST_SCHEDULED: 'request.scheduled',
  REQUEST_ACTIVATED_SCHEDULED: 'request.activated_scheduled',
  REQUEST_CANCELLED: 'request.cancelled',
  REQUEST_SCHEDULED_CANCELLED: 'request.scheduled_cancelled',
  REQUEST_MANUAL_REMIND: 'request.manual_remind',
  REQUEST_REQUESTER_REASSIGNED: 'request.requester_reassigned',

  // assignment 関連
  ASSIGNMENT_FORWARDED: 'assignment.forwarded',
  ASSIGNMENT_SUBSTITUTED: 'assignment.substituted',
  ASSIGNMENT_EXEMPTED: 'assignment.exempted',
  ASSIGNMENT_MANUAL_REMIND: 'assignment.manual_remind',

  // request_template 関連
  REQUEST_TEMPLATE_CREATED: 'request_template.created',
  REQUEST_TEMPLATE_UPDATED: 'request_template.updated',
  REQUEST_TEMPLATE_ARCHIVED: 'request_template.archived',

  // admin 操作
  ADMIN_USER_STATUS_CHANGED: 'admin.user.status_changed',
  ADMIN_USER_ROLES_CHANGED: 'admin.user.roles_changed',
  ADMIN_USER_ORG_UNITS_CHANGED: 'admin.user.org_units_changed',

  // org_unit_manager 関連
  ORG_UNIT_MANAGER_ADD: 'org_unit_manager.add',
  ORG_UNIT_MANAGER_REMOVE: 'org_unit_manager.remove',
  ORG_UNIT_MANAGER_TRANSFERRED: 'org_unit_manager.transferred',

  // tenant / settings 関連
  TENANT_POSITION_CONFIG_CHANGED: 'tenant.position_config_changed',
  SETTINGS_NOTIFICATION_UPDATED: 'settings.notification.updated',
  SETTINGS_RETENTION_CHANGED: 'settings.retention.changed',

  // user_role 関連
  USER_ROLE_MANAGER_SYNCED: 'user_role.manager_synced',

  // notification 関連
  NOTIFICATION_RETRY_REQUESTED: 'notification.retry_requested',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

// ─────────────────────────────────────────────────────────
// Notification kind
// ─────────────────────────────────────────────────────────

export const NOTIFICATION_KIND = {
  CREATED: 'created',
  REMINDER_BEFORE: 'reminder_before',
  DUE_TODAY: 'due_today',
  RE_NOTIFY: 're_notify',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type NotificationKind = (typeof NOTIFICATION_KIND)[keyof typeof NOTIFICATION_KIND];
