-- Fix 2: schema_migrations is runner meta — deny nudge_app entirely
REVOKE ALL ON schema_migrations FROM nudge_app;

-- Fix 1: tenant table must be restricted by RLS too
REVOKE INSERT, UPDATE, DELETE ON tenant FROM nudge_app;
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Fix 3: fail-closed policy expression on all tenant-scoped tables
-- DROP + CREATE (ALTER POLICY doesn't support expression change)
DO $$
DECLARE
  t TEXT;
  tables TEXT[] := ARRAY[
    'users','org_unit','org_unit_closure','user_org_unit','org_unit_manager',
    'group','group_member','user_role',
    'request','request_target','assignment','assignment_status_history',
    'tenant_notification_config','user_notification_pref','notification_rule','notification',
    'audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    $p$, t);
  END LOOP;
END $$;
