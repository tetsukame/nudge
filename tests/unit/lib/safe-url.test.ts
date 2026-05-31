import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSafeHttpUrl,
  assertSafeHostname,
  SafeUrlError,
} from '../../../src/lib/safe-url.js';

describe('assertSafeHttpUrl', () => {
  const originalAllowlist = process.env.SAFE_URL_HOST_ALLOWLIST;
  beforeEach(() => { delete process.env.SAFE_URL_HOST_ALLOWLIST; });
  afterEach(() => {
    if (originalAllowlist === undefined) delete process.env.SAFE_URL_HOST_ALLOWLIST;
    else process.env.SAFE_URL_HOST_ALLOWLIST = originalAllowlist;
  });

  it('accepts a regular public https URL', async () => {
    // example.com resolves to a public IP
    await expect(assertSafeHttpUrl('https://example.com/path')).resolves.toBeInstanceOf(URL);
  });

  it('rejects non-http(s) protocols', async () => {
    await expect(assertSafeHttpUrl('ftp://example.com')).rejects.toThrow(SafeUrlError);
    await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toThrow(SafeUrlError);
    await expect(assertSafeHttpUrl('gopher://example.com')).rejects.toThrow(SafeUrlError);
  });

  it('rejects malformed URLs', async () => {
    await expect(assertSafeHttpUrl('not a url')).rejects.toThrow(SafeUrlError);
    await expect(assertSafeHttpUrl('')).rejects.toThrow(SafeUrlError);
  });

  it('rejects literal private IP (RFC1918)', async () => {
    await expect(assertSafeHttpUrl('http://192.168.1.105:5432/')).rejects.toThrow(/private/);
    await expect(assertSafeHttpUrl('http://10.0.0.1/')).rejects.toThrow(/private/);
    await expect(assertSafeHttpUrl('http://172.16.0.1/')).rejects.toThrow(/private/);
  });

  it('rejects literal loopback', async () => {
    await expect(assertSafeHttpUrl('http://127.0.0.1:8080/')).rejects.toThrow(/loopback/);
    await expect(assertSafeHttpUrl('http://[::1]/')).rejects.toThrow(/loopback/);
  });

  it('rejects cloud metadata (169.254.169.254)', async () => {
    await expect(assertSafeHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/link-local/);
  });

  it('allows loopback when opts.allowLoopback=true', async () => {
    await expect(
      assertSafeHttpUrl('http://127.0.0.1:8080/', { allowLoopback: true }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('allows hostname listed in opts.allowedHosts (skip IP check)', async () => {
    // host.docker.internal would normally resolve to private; allowlist passes through
    await expect(
      assertSafeHttpUrl('http://host.docker.internal:1234/v1', {
        allowedHosts: ['host.docker.internal'],
      }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('honors SAFE_URL_HOST_ALLOWLIST env var', async () => {
    process.env.SAFE_URL_HOST_ALLOWLIST = 'internal-svc.example,host.docker.internal';
    await expect(
      assertSafeHttpUrl('http://host.docker.internal:1234/v1'),
    ).resolves.toBeInstanceOf(URL);
  });
});

describe('assertSafeHostname', () => {
  it('rejects empty', async () => {
    await expect(assertSafeHostname('')).rejects.toThrow(SafeUrlError);
    await expect(assertSafeHostname('  ')).rejects.toThrow(SafeUrlError);
  });

  it('rejects literal private IP', async () => {
    await expect(assertSafeHostname('192.168.1.1')).rejects.toThrow(/private/);
  });

  it('accepts a public hostname', async () => {
    await expect(assertSafeHostname('smtp.gmail.com')).resolves.toBeUndefined();
  });
});
