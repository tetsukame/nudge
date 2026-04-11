CREATE TABLE org_unit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  parent_id   UUID REFERENCES org_unit(id),
  name        TEXT NOT NULL,
  level       SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX org_unit_tenant_parent_idx ON org_unit (tenant_id, parent_id);
