-- NDG-73 Phase 1: AI 整形 (Dify / OpenAI 互換) のテナント設定。
-- 1 テナント 1 プロバイダ。enabled=false がデフォルト。
-- API キーは AES-256-GCM (src/notification/crypto.ts) で暗号化保存。

CREATE TABLE tenant_ai_config (
  tenant_id              UUID PRIMARY KEY REFERENCES tenant(id),
  enabled                BOOLEAN NOT NULL DEFAULT false,
  provider               TEXT NOT NULL
    CHECK (provider IN ('dify', 'openai_compat')),
  endpoint               TEXT NOT NULL,
  dify_app_id            TEXT,
  model                  TEXT,
  api_key_encrypted      TEXT,
  system_prompt          TEXT,
  default_user_prompt    TEXT,
  extras                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_ai_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_ai_config_tenant_isolation ON tenant_ai_config
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
