CREATE TABLE notification (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  request_id        UUID REFERENCES request(id),
  assignment_id     UUID REFERENCES assignment(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  channel           TEXT NOT NULL
    CHECK (channel IN ('in_app','email','teams','slack')),
  kind              TEXT NOT NULL
    CHECK (kind IN ('created','reminder_before','due_today','re_notify','completed')),
  scheduled_at      TIMESTAMPTZ NOT NULL,
  sent_at           TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','skipped')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_pending_idx
  ON notification (status, scheduled_at) WHERE status = 'pending';
CREATE INDEX notification_recipient_idx
  ON notification (tenant_id, recipient_user_id, created_at DESC);
