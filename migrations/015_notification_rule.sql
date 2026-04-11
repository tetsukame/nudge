CREATE TABLE notification_rule (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id),
  request_id   UUID REFERENCES request(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL
    CHECK (kind IN ('created','reminder_before','due_today','re_notify','completed')),
  offset_days  INTEGER NOT NULL DEFAULT 0,
  offset_hours INTEGER NOT NULL DEFAULT 0,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_rule_tenant_request_idx ON notification_rule (tenant_id, request_id);
