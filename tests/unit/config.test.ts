import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigCache } from '../../src/config.js';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_APP;
    delete process.env.IRON_SESSION_PASSWORD;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    delete process.env.OIDC_REDIRECT_URI_BASE;
    delete process.env.SYNC_API_KEY;
    resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
  });

  const valid = {
    DATABASE_URL_ADMIN: 'postgresql://admin:x@localhost:5432/test',
    DATABASE_URL_APP: 'postgresql://app:x@localhost:5432/test',
    IRON_SESSION_PASSWORD: 'a'.repeat(32),
    OIDC_CLIENT_ID: 'nudge-web',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI_BASE: 'http://localhost:3000',
  };

  it('loads valid config', () => {
    Object.assign(process.env, valid);
    const cfg = loadConfig();
    expect(cfg.DATABASE_URL_ADMIN).toBe(valid.DATABASE_URL_ADMIN);
    expect(cfg.IRON_SESSION_PASSWORD).toBe(valid.IRON_SESSION_PASSWORD);
  });

  it('rejects missing DATABASE_URL_APP', () => {
    Object.assign(process.env, valid);
    delete process.env.DATABASE_URL_APP;
    expect(() => loadConfig()).toThrow(/DATABASE_URL_APP/);
  });

  it('rejects short IRON_SESSION_PASSWORD', () => {
    Object.assign(process.env, { ...valid, IRON_SESSION_PASSWORD: 'short' });
    expect(() => loadConfig()).toThrow(/IRON_SESSION_PASSWORD/);
  });

  it('rejects invalid OIDC_REDIRECT_URI_BASE', () => {
    Object.assign(process.env, { ...valid, OIDC_REDIRECT_URI_BASE: 'not-a-url' });
    expect(() => loadConfig()).toThrow(/OIDC_REDIRECT_URI_BASE/);
  });

  it('loads config with optional SYNC_API_KEY', () => {
    Object.assign(process.env, { ...valid, SYNC_API_KEY: 'my-sync-key' });
    const cfg = loadConfig();
    expect(cfg.SYNC_API_KEY).toBe('my-sync-key');
  });

  it('loads config without SYNC_API_KEY', () => {
    Object.assign(process.env, valid);
    const cfg = loadConfig();
    expect(cfg.SYNC_API_KEY).toBeUndefined();
  });
});
