-- 030: Tenant-wide settings: SMTP config + reminder cadence

CREATE TABLE tenant_settings (
  tenant_id                UUID PRIMARY KEY REFERENCES tenant(id),
  smtp_host                TEXT,
  smtp_port                INTEGER,
  smtp_user                TEXT,
  smtp_password_encrypted  TEXT,
  smtp_from                TEXT,
  smtp_secure              BOOLEAN NOT NULL DEFAULT false,
  reminder_before_days     INTEGER NOT NULL DEFAULT 1,
  re_notify_interval_days  INTEGER NOT NULL DEFAULT 3,
  re_notify_max_count      INTEGER NOT NULL DEFAULT 5,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_isolation ON tenant_settings
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
