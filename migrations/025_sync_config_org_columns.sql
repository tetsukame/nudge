ALTER TABLE tenant_sync_config RENAME COLUMN source_type TO user_source_type;

ALTER TABLE tenant_sync_config ADD COLUMN org_source_type TEXT NOT NULL DEFAULT 'none'
  CHECK (org_source_type IN ('keycloak', 'csv', 'none'));

ALTER TABLE tenant_sync_config DROP CONSTRAINT IF EXISTS tenant_sync_config_source_type_check;
ALTER TABLE tenant_sync_config DROP CONSTRAINT IF EXISTS tenant_sync_config_user_source_type_check;
ALTER TABLE tenant_sync_config ADD CONSTRAINT tenant_sync_config_user_source_type_check
  CHECK (user_source_type IN ('keycloak', 'csv', 'none'));

ALTER TABLE tenant_sync_config ADD COLUMN org_group_prefix TEXT DEFAULT '/組織';
ALTER TABLE tenant_sync_config ADD COLUMN team_group_prefix TEXT;
ALTER TABLE tenant_sync_config ADD COLUMN ignore_group_prefixes TEXT[];
