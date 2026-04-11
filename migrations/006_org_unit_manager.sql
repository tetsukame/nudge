CREATE TABLE org_unit_manager (
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  org_unit_id  UUID NOT NULL REFERENCES org_unit(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_unit_id, user_id)
);
