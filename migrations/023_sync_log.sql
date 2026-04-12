CREATE TABLE sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  sync_type         TEXT NOT NULL CHECK (sync_type IN ('full', 'delta')),
  source_type       TEXT NOT NULL DEFAULT 'keycloak',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed')),
  created_count     INTEGER NOT NULL DEFAULT 0,
  updated_count     INTEGER NOT NULL DEFAULT 0,
  deactivated_count INTEGER NOT NULL DEFAULT 0,
  reactivated_count INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT
);
CREATE INDEX sync_log_tenant_started_idx ON sync_log (tenant_id, started_at DESC);
