-- NDG-111 (v0.26): tenant ごとの認証プロバイダ設定。
--
-- 既存: OIDC_CLIENT_ID / OIDC_CLIENT_SECRET (env, 全 tenant 共有)
--       + tenant.keycloak_issuer_url (per-tenant KC issuer)
--
-- 目的: tenant ごとに provider 種別 (keycloak / generic-oidc) と資格情報を
-- 独立に持たせ、Pocket ID / Entra ID などへの差替えを可能にする。
--
-- 後方互換: このテーブルに row が無い tenant は従来通り env + KC を使う。
-- 新規 tenant / GenericOidcAdapter への切替時のみ row が作られる (Sub D の
-- 管理 UI 経由)。既存 tenant の強制移行は NDG-119 (移行 J) で扱う。
--
-- client_secret は AES-256-GCM で暗号化 (KEK_MASTER_KEY 使用)。tenant_ai_config
-- / tenant_sync_config と同じ crypto ヘルパを共有。
--
-- claim_mapping は OIDC C (NDG-112) で拡張予定。現時点は空 JSON がデフォルト。

CREATE TABLE tenant_auth_config (
  tenant_id                UUID PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  provider_type            TEXT NOT NULL CHECK (provider_type IN ('keycloak', 'generic-oidc')),
  issuer_url               TEXT NOT NULL,
  client_id                TEXT NOT NULL,
  client_secret_encrypted  TEXT NOT NULL,
  claim_mapping            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: tenant 内での SELECT/UPDATE のみ許可 (tenant_admin 権限は API 層で判定)
ALTER TABLE tenant_auth_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_auth_config_isolation ON tenant_auth_config
  USING (tenant_id = current_setting('app.current_tenant', true)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_auth_config TO nudge_app;
