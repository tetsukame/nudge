-- 045: Add 'manager' to user_role CHECK constraint (NDG-47)
-- 「管理職」フラグを持つユーザーを user_role.role='manager' で表現する。
-- このフラグが ON のユーザーは異動 (主所属変更) があったときに新主所属を
-- 自動で `org_unit_manager` に登録するロジックの対象になる。

ALTER TABLE user_role
  DROP CONSTRAINT user_role_role_check;

ALTER TABLE user_role
  ADD CONSTRAINT user_role_role_check
    CHECK (role IN ('tenant_admin', 'tenant_wide_requester', 'manager'));
