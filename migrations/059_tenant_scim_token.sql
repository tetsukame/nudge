-- NDG-115 (v0.26): SCIM 2.0 push 受信用の Bearer token を tenant ごとに保持。
--
-- 平文は発行時に 1 度だけ表示 (CLI stdout)。以後は bcrypt hash のみ保存し、
-- 検証時に生 token を hash と比較する (platform_admin の password と同じ扱い)。
--
-- tenant あたり 1 レコード。ローテートは同じ tenant_id に対する upsert で
-- 新 hash に置き換える。過去 token は即座に失効する。

CREATE TABLE tenant_scim_token (
  tenant_id     UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);

-- admin pool 経由のみ触る (SCIM リクエストは自前で tenant を解決する route で
-- 動くため、RLS 依存しない)。app pool からのアクセスは不要。
