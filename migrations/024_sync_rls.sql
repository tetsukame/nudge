-- tenant_sync_config
ALTER TABLE tenant_sync_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sync_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_sync_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- sync_log
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_log
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- nudge_app に権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_sync_config TO nudge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_log TO nudge_app;
