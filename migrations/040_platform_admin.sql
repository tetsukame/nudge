-- 040: Platform admin (root) — Nudge SaaS 提供事業者向けプラットフォーム管理者 (NDG-22)
-- テナント (`users`) とは完全に分離。テナントを跨いで管理を行う。
-- 認証はローカル (bcrypt) で、KC 障害時もログイン可能。

CREATE TABLE platform_admin (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  display_name    TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- RLS は不要 (platform_admin はテナント横断のため)。
-- ただし app pool からは触れないようにアクセスを制限したい。
-- v0.13 では admin pool 経由のみ参照する運用とする (RLS なしで OK)。

CREATE INDEX platform_admin_email_idx ON platform_admin (email) WHERE status = 'active';
