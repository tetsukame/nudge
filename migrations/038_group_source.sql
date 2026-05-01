-- 038: Add source column to "group" (NDG-9)
-- Nudge 独自グループと Keycloak 同期グループを完全分離するための識別列。
-- 'nudge'    = Nudge UI から作成されたグループ。作成者 or tenant_admin が編集可
-- 'keycloak' = KC 同期で投入されたグループ。Nudge UI からは read-only

ALTER TABLE "group"
  ADD COLUMN source TEXT NOT NULL DEFAULT 'nudge'
  CHECK (source IN ('nudge', 'keycloak'));

CREATE INDEX group_tenant_source_idx ON "group" (tenant_id, source);
