-- 046: Keycloak 属性から「管理職」フラグを同期するための土台 (NDG-48)
--
-- - tenant_position_config: テナントごとに「どの職位を管理職とみなすか」を保持。
--   KC user attribute `position` の値がこの配列に含まれれば user_role.manager
--   を付与する。
-- - users.manager_source: 'kc' = 同期由来、'manual' = admin UI で手動トグル。
--   'manual' のユーザーは KC 同期で manager ロールを書き換えない（手動運用を保護）。
-- - users.synced_position: 直近の KC position 値。admin UI の表示用。

CREATE TABLE tenant_position_config (
  tenant_id          UUID PRIMARY KEY REFERENCES tenant(id),
  manager_positions  TEXT[] NOT NULL DEFAULT ARRAY['課長','部長','室長','本部長'],
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_position_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_position_config_isolation ON tenant_position_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE users
  ADD COLUMN manager_source TEXT
    CHECK (manager_source IN ('kc', 'manual')),
  ADD COLUMN synced_position TEXT;
