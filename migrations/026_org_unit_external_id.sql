ALTER TABLE org_unit ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX org_unit_tenant_external_idx
  ON org_unit (tenant_id, external_id) WHERE external_id IS NOT NULL;
