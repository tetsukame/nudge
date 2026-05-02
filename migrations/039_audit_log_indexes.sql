-- 039: Indexes for audit_log filtering UI (NDG-1)
-- フィルタの想定条件: actor / action / 日付範囲 (created_at DESC)

CREATE INDEX IF NOT EXISTS audit_log_actor_created_idx
  ON audit_log (tenant_id, actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_action_created_idx
  ON audit_log (tenant_id, action, created_at DESC);
