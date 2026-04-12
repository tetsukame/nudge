ALTER TABLE tenant ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'oidc'
  CHECK (auth_mode IN ('oidc', 'local'));
