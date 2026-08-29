import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testOidcDiscovery } from '../../../../src/domain/auth/discovery-test.js';

describe('testOidcDiscovery', () => {
  const originalAllowlist = process.env.SAFE_URL_HOST_ALLOWLIST;

  beforeEach(() => {
    // discovery-test の SSRF ガードは Node の DNS を叩くので、テスト内で
    // 使う架空ホストを事前に許可する必要がある
    process.env.SAFE_URL_HOST_ALLOWLIST = 'kc.example.com,pocket.invalid';
  });
  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.SAFE_URL_HOST_ALLOWLIST;
    } else {
      process.env.SAFE_URL_HOST_ALLOWLIST = originalAllowlist;
    }
  });

  it('returns ok:false when issuer is empty', async () => {
    const r = await testOidcDiscovery('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/空/);
  });

  it('returns ok:false for javascript: scheme (SafeUrl guard)', async () => {
    const r = await testOidcDiscovery('javascript:alert(1)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/issuer_url/);
  });

  it('returns ok:false when discovery endpoint is unreachable', async () => {
    // 未登録の .invalid ホストを使う → DNS 解決失敗で discovery が投げる
    const r = await testOidcDiscovery('https://pocket.invalid');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Discovery/);
  });
});
