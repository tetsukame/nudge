CREATE TABLE "group" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenant(id),
  name                TEXT NOT NULL,
  description         TEXT,
  created_by_user_id  UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE group_member (
  tenant_id         UUID NOT NULL REFERENCES tenant(id),
  group_id          UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id),
  added_by_user_id  UUID NOT NULL REFERENCES users(id),
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
