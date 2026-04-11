CREATE TABLE request (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  type                TEXT NOT NULL
    CHECK (type IN ('survey', 'task')),
  title               TEXT NOT NULL,
  body                TEXT,
  external_url        TEXT,
  due_at              TIMESTAMPTZ,
  allow_forward       BOOLEAN NOT NULL DEFAULT true,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'closed', 'cancelled')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX request_tenant_status_due_idx ON request (tenant_id, status, due_at);
