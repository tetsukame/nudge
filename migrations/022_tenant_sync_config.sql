CREATE TABLE tenant_sync_config (
  tenant_id           UUID PRIMARY KEY REFERENCES tenant(id),
  source_type         TEXT NOT NULL DEFAULT 'keycloak'
    CHECK (source_type IN ('keycloak')),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  sync_client_id      TEXT,
  sync_client_secret  TEXT,
  interval_minutes    INTEGER NOT NULL DEFAULT 60,
  last_full_synced_at   TIMESTAMPTZ,
  last_delta_synced_at  TIMESTAMPTZ,
  last_error          TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
