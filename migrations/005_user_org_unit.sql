CREATE TABLE user_org_unit (
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  user_id      UUID NOT NULL REFERENCES users(id),
  org_unit_id  UUID NOT NULL REFERENCES org_unit(id),
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_unit_id)
);
CREATE UNIQUE INDEX user_org_unit_primary_idx
  ON user_org_unit (user_id) WHERE is_primary;
