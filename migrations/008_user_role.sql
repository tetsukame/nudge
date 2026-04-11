CREATE TABLE user_role (
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  user_id             UUID NOT NULL REFERENCES users(id),
  role                TEXT NOT NULL
    CHECK (role IN ('tenant_admin', 'tenant_wide_requester')),
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by_user_id  UUID REFERENCES users(id),
  PRIMARY KEY (user_id, role)
);
