-- 028: Request comments (broadcast + individual Q&A) + unread tracking

CREATE TABLE request_comment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant(id),
  request_id      UUID NOT NULL REFERENCES request(id) ON DELETE CASCADE,
  assignment_id   UUID REFERENCES assignment(id),
  author_user_id  UUID NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX request_comment_request_idx
  ON request_comment (request_id, created_at);
CREATE INDEX request_comment_assignment_idx
  ON request_comment (assignment_id, created_at)
  WHERE assignment_id IS NOT NULL;

-- RLS
ALTER TABLE request_comment ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_comment_tenant_isolation ON request_comment
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Unread tracking
ALTER TABLE assignment ADD COLUMN last_viewed_at TIMESTAMPTZ;
