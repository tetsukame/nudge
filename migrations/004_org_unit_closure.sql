CREATE TABLE org_unit_closure (
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  ancestor_id    UUID NOT NULL REFERENCES org_unit(id),
  descendant_id  UUID NOT NULL REFERENCES org_unit(id),
  depth          SMALLINT NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX org_unit_closure_tenant_desc_idx
  ON org_unit_closure (tenant_id, descendant_id);
