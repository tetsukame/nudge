CREATE TABLE user_notification_pref (
  tenant_id   UUID NOT NULL REFERENCES tenant(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  channel     TEXT NOT NULL
    CHECK (channel IN ('in_app', 'email', 'teams', 'slack')),
  enabled     BOOLEAN NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);
