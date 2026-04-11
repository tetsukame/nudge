CREATE TABLE request_target (
  tenant_id            UUID NOT NULL REFERENCES tenant(id),
  request_id           UUID NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  target_type          TEXT NOT NULL
    CHECK (target_type IN ('org_unit', 'group', 'user')),
  target_id            UUID NOT NULL,
  include_descendants  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (request_id, target_type, target_id)
);
