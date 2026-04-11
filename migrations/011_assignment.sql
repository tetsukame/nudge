CREATE TABLE assignment (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                      UUID NOT NULL REFERENCES tenant(id),
  request_id                     UUID NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  user_id                        UUID NOT NULL REFERENCES users(id),
  status                         TEXT NOT NULL DEFAULT 'unopened'
    CHECK (status IN ('unopened','opened','responded','unavailable',
                      'forwarded','substituted','exempted','expired')),
  opened_at                      TIMESTAMPTZ,
  responded_at                   TIMESTAMPTZ,
  forwarded_from_assignment_id   UUID REFERENCES assignment(id),
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, user_id)
);
CREATE INDEX assignment_tenant_user_status_idx ON assignment (tenant_id, user_id, status);
CREATE INDEX assignment_request_status_idx ON assignment (request_id, status);
