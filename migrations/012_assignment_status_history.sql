CREATE TABLE assignment_status_history (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenant(id),
  assignment_id            UUID NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  from_status              TEXT,
  to_status                TEXT NOT NULL,
  transition_kind          TEXT NOT NULL
    CHECK (transition_kind IN (
      'auto_open','user_respond','user_unavailable','user_forward',
      'manager_substitute','admin_exempt','auto_expire'
    )),
  transitioned_by_user_id  UUID REFERENCES users(id),
  reason                   TEXT,
  forwarded_to_user_id     UUID REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assignment_status_history_asg_idx
  ON assignment_status_history (assignment_id, created_at);
