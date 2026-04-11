CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenant (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  keycloak_realm       TEXT NOT NULL,
  keycloak_issuer_url  TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
