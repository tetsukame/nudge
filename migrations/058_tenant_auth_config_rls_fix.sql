-- NDG-113 追随: 057 で作った tenant_auth_config の RLS ポリシーが動かない
-- (1) setting 名が誤 (`app.current_tenant` → 正しくは `app.tenant_id`)
-- (2) WITH CHECK 節が無いため INSERT が拒否される (SELECT だけ通っていた)
--
-- 他テーブル (024_sync_rls, 053_tenant_ai_config) と同じ書式に揃える。

DROP POLICY IF EXISTS tenant_auth_config_isolation ON tenant_auth_config;

CREATE POLICY tenant_auth_config_isolation ON tenant_auth_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
