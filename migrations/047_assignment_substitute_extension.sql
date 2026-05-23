-- NDG-61: 代理完了のガバナンス強化
-- 1) 代理完了の理由カテゴリを保存する列を追加
-- 2) tenant_admin による代理完了を区別するために transition_kind に admin_substitute を許可

ALTER TABLE assignment
  ADD COLUMN substitute_reason_code TEXT
    CHECK (substitute_reason_code IS NULL
           OR substitute_reason_code IN ('absent', 'urgent', 'overdue_rescue', 'other'));

ALTER TABLE assignment_status_history
  DROP CONSTRAINT assignment_status_history_transition_kind_check;

ALTER TABLE assignment_status_history
  ADD CONSTRAINT assignment_status_history_transition_kind_check
  CHECK (transition_kind IN (
    'auto_open','user_respond','user_not_needed','user_forward',
    'manager_substitute','admin_substitute','admin_exempt','auto_expire'
  ));
