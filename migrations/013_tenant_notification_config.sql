CREATE TABLE tenant_notification_config (
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  channel             TEXT NOT NULL
    CHECK (channel IN ('in_app', 'email', 'teams', 'slack')),
  enabled             BOOLEAN NOT NULL DEFAULT false,
  config_json         JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id  UUID REFERENCES users(id),
  PRIMARY KEY (tenant_id, channel)
);
