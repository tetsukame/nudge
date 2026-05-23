-- NDG-67: 監査閲覧専用ロール (auditor) を追加
-- - 監査ログ閲覧のみ可、ユーザー / 組織 / 依頼の編集は不可
-- - デフォルト OFF (手動付与のみ)
-- - 付与/剥奪操作そのものは既存の setUserRoles で audit_log (admin.user.roles_changed) に記録される

ALTER TABLE user_role DROP CONSTRAINT user_role_role_check;
ALTER TABLE user_role ADD CONSTRAINT user_role_role_check
  CHECK (role IN ('tenant_admin', 'tenant_wide_requester', 'manager', 'auditor'));
