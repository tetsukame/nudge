CREATE TABLE audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenant(id),
  actor_user_id  UUID REFERENCES users(id),
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      UUID,
  payload_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address     INET,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_created_idx ON audit_log (tenant_id, created_at DESC);
CREATE INDEX audit_log_tenant_target_idx ON audit_log (tenant_id, target_type, target_id);
