-- アプリケーション実行用ロール（RLS が効く非 SUPERUSER）
CREATE ROLE nudge_app NOLOGIN;
GRANT USAGE ON SCHEMA public TO nudge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO nudge_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nudge_app;

-- すべてのテナントスコープテーブルに対し RLS 有効化 + ポリシー
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'users',
    'org_unit',
    'org_unit_closure',
    'user_org_unit',
    'org_unit_manager',
    'group',
    'group_member',
    'user_role',
    'request',
    'request_target',
    'assignment',
    'assignment_status_history',
    'tenant_notification_config',
    'user_notification_pref',
    'notification_rule',
    'notification',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)
    $p$, t);
  END LOOP;
END $$;
